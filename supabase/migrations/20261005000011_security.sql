-- =====================================================================
-- 0011 SECURITY: authentication policy (OTP), session registry, trusted
-- devices, login & security event logs, rate limiting.
--
-- Session gating: every Supabase session (JWT claim `session_id`) must be
-- registered and ACTIVE in public.user_sessions before has_permission()
-- grants anything. A session waiting for its email OTP, or a revoked
-- session, therefore cannot read or write data even when it talks to the
-- database API directly (bypassing the web application).
-- =====================================================================

create table public.auth_security_settings (
  id integer primary key default 1 check (id = 1),
  otp_mode text not null default 'disabled' check (otp_mode in ('disabled', 'new_device', 'every_login')),
  otp_scope text not null default 'all' check (otp_scope in ('all', 'roles')),
  otp_length integer not null default 6 check (otp_length between 6 and 8),
  otp_ttl_seconds integer not null default 300 check (otp_ttl_seconds between 60 and 900),
  otp_max_attempts integer not null default 5 check (otp_max_attempts between 3 and 10),
  otp_resend_cooldown_seconds integer not null default 60 check (otp_resend_cooldown_seconds between 30 and 600),
  otp_max_sends_per_hour integer not null default 5 check (otp_max_sends_per_hour between 2 and 20),
  trusted_device_days integer not null default 30 check (trusted_device_days between 1 and 180),
  login_max_failures integer not null default 5 check (login_max_failures between 3 and 20),
  login_lockout_minutes integer not null default 15 check (login_lockout_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
insert into public.auth_security_settings (id) values (1) on conflict do nothing;

create table public.otp_role_requirements (
  role_id uuid primary key references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,                 -- HMAC of an httpOnly random device cookie
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique (user_id, device_hash)
);

create table public.user_sessions (
  id uuid primary key,                       -- = Supabase auth session id (JWT claim session_id)
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending_otp', 'active', 'revoked', 'signed_out')),
  auth_method text not null default 'password' check (auth_method in ('password', 'password_otp', 'recovery', 'other')),
  otp_required boolean not null default false,
  otp_verified_at timestamptz,
  device_hash text,
  new_device boolean not null default false,
  ip text,
  user_agent text check (length(user_agent) <= 512),
  browser text,
  os text,
  device_type text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  revoked_by uuid,
  revoke_reason text
);
create index user_sessions_user_idx on public.user_sessions(user_id, created_at desc);
create index user_sessions_active_idx on public.user_sessions(user_id) where status = 'active';

create table public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.user_sessions(id) on delete cascade,
  code_hash text not null,                   -- HMAC-SHA256; the code itself is never stored
  expires_at timestamptz not null,
  attempts integer not null default 0,
  max_attempts integer not null,
  sends integer not null default 1,
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_challenges_session_idx on public.otp_challenges(session_id, created_at desc);
create index otp_challenges_user_idx on public.otp_challenges(user_id, created_at desc);

create table public.login_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event text not null check (event in (
    'login_success', 'login_failed', 'login_locked', 'logout', 'session_started',
    'otp_sent', 'otp_verified', 'otp_failed', 'otp_expired', 'otp_locked',
    'session_revoked', 'password_changed', 'password_reset_requested')),
  user_id uuid,
  email text,
  session_id uuid,
  ip text,
  user_agent text,
  browser text,
  os text,
  device_type text,
  auth_method text,
  otp_used boolean,
  reason text
);
create index login_events_occurred_idx on public.login_events(occurred_at desc);
create index login_events_user_idx on public.login_events(user_id, occurred_at desc);
create index login_events_email_idx on public.login_events(lower(email), occurred_at desc) where event = 'login_failed';

create table public.security_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]*$'),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  actor_id uuid,
  target_user_id uuid,
  session_id uuid,
  ip text,
  summary text not null check (length(summary) <= 500),
  metadata jsonb not null default '{}'::jsonb
);
create index security_events_occurred_idx on public.security_events(occurred_at desc);
create index security_events_type_idx on public.security_events(event_type, occurred_at desc);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

-- Append-only logs.
create trigger login_events_immutable before update or delete on public.login_events
  for each row execute function public.tg_audit_logs_immutable();
create trigger security_events_immutable before update or delete on public.security_events
  for each row execute function public.tg_audit_logs_immutable();

-- ---------------------------------------------------------------------
-- Session gate
-- ---------------------------------------------------------------------
create or replace function public.current_session_id()
returns uuid
language plpgsql
stable
as $$
begin
  return nullif(auth.jwt() ->> 'session_id', '')::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.session_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_sessions s
     where s.id = public.current_session_id() and s.user_id = auth.uid() and s.status = 'active');
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.session_active() and exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id and r.active
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid()
      and p.active
      and rp.permission_code = p_code
  );
$$;

-- Own data without a specific permission still requires an active session.
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = auth.uid() and public.session_active());
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = auth.uid() and public.session_active()) with check (recipient_id = auth.uid());
drop policy if exists user_notification_preferences_own on public.user_notification_preferences;
create policy user_notification_preferences_own on public.user_notification_preferences for all to authenticated
  using (user_id = auth.uid() and public.session_active()) with check (user_id = auth.uid() and public.session_active());

create or replace function public.otp_required_for(p_user uuid, p_device_hash text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.auth_security_settings;
  v_role uuid;
begin
  select * into s from public.auth_security_settings where id = 1;
  if s.otp_mode = 'disabled' then return false; end if;
  select role_id into v_role from public.profiles where id = p_user;
  if s.otp_scope = 'roles' and not exists (select 1 from public.otp_role_requirements where role_id = v_role) then
    return false;
  end if;
  if s.otp_mode = 'every_login' then return true; end if;
  -- new_device: a trusted (OTP-verified, unexpired) device skips the code.
  return not exists (
    select 1 from public.trusted_devices t
     where t.user_id = p_user and t.device_hash = p_device_hash
       and t.revoked_at is null and t.expires_at > now());
end;
$$;

-- Called by the app server right after sign-in with the user's own JWT.
-- Idempotent for the same session. Returns the session state.
create or replace function public.register_session(
  p_device_hash text, p_ip text, p_user_agent text, p_browser text, p_os text, p_device_type text,
  p_auth_method text default 'password')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.current_session_id();
  v_row public.user_sessions;
  v_required boolean;
  v_new_device boolean;
  v_email text;
begin
  if v_uid is null or v_sid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and active) then
    raise exception 'Account disabled.' using errcode = '42501';
  end if;
  select * into v_row from public.user_sessions where id = v_sid;
  if found then
    if v_row.user_id <> v_uid then
      raise exception 'Session mismatch.' using errcode = '42501';
    end if;
    return jsonb_build_object('status', v_row.status, 'otp_required', v_row.otp_required, 'new_device', v_row.new_device);
  end if;

  p_device_hash := nullif(left(coalesce(p_device_hash, ''), 128), '');
  v_required := public.otp_required_for(v_uid, coalesce(p_device_hash, '-'));
  v_new_device := p_device_hash is null or not exists (
    select 1 from public.user_sessions s where s.user_id = v_uid and s.device_hash = p_device_hash
       and (s.status = 'active' or s.otp_verified_at is not null or not s.otp_required))
    and not exists (select 1 from public.trusted_devices t where t.user_id = v_uid and t.device_hash = p_device_hash);

  insert into public.user_sessions (id, user_id, status, auth_method, otp_required, device_hash, new_device,
                                    ip, user_agent, browser, os, device_type)
  values (v_sid, v_uid, case when v_required then 'pending_otp' else 'active' end,
          case when p_auth_method in ('password', 'recovery', 'other') then p_auth_method else 'other' end,
          v_required, p_device_hash, v_new_device,
          left(p_ip, 64), left(p_user_agent, 512), left(p_browser, 60), left(p_os, 60), left(p_device_type, 20))
  returning * into v_row;

  select email into v_email from public.profiles where id = v_uid;
  insert into public.login_events (event, user_id, email, session_id, ip, user_agent, browser, os, device_type, auth_method, otp_used)
  values ('session_started', v_uid, v_email, v_sid, left(p_ip, 64), left(p_user_agent, 512),
          left(p_browser, 60), left(p_os, 60), left(p_device_type, 20), v_row.auth_method, false);

  if not v_required then
    perform public.session_activated(v_sid);
  end if;
  return jsonb_build_object('status', v_row.status, 'otp_required', v_required, 'new_device', v_new_device);
end;
$$;

-- Side effects once a session becomes active: new-login alert.
create or replace function public.session_activated(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.user_sessions;
begin
  select * into s from public.user_sessions where id = p_session;
  if not found or s.status <> 'active' then return; end if;
  if s.new_device then
    perform public.notify_user(s.user_id, 'new_login', 'New login detected',
      concat_ws(' / ', s.browser, s.os),
      jsonb_build_object('session_id', s.id, 'browser', s.browser, 'os', s.os, 'device_type', s.device_type,
                         'login_at', s.created_at),
      '/settings/security', null, 'session', s.id);
  end if;
  if s.otp_verified_at is not null then
    perform public.notify_user(s.user_id, 'otp_verified', 'OTP login completed', concat_ws(' / ', s.browser, s.os),
      jsonb_build_object('session_id', s.id), '/settings/security', null, 'session', s.id);
  end if;
end;
$$;

-- Session state for the current request (touches last_seen at most every 5 min).
create or replace function public.current_session_state()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sid uuid := public.current_session_id();
  v_status text;
begin
  if auth.uid() is null or v_sid is null then return 'unregistered'; end if;
  update public.user_sessions set last_seen_at = now()
   where id = v_sid and user_id = auth.uid() and status = 'active' and last_seen_at < now() - interval '5 minutes';
  select status into v_status from public.user_sessions where id = v_sid and user_id = auth.uid();
  return coalesce(v_status, 'unregistered');
end;
$$;

create or replace function public.log_security_event(
  p_type text, p_severity text, p_summary text, p_target uuid default null, p_metadata jsonb default '{}'::jsonb,
  p_actor uuid default null, p_ip text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.security_events (event_type, severity, actor_id, target_user_id, session_id, ip, summary, metadata)
  values (p_type, p_severity, coalesce(p_actor, auth.uid()), p_target, public.current_session_id(), left(p_ip, 64),
          left(p_summary, 500), coalesce(p_metadata, '{}'::jsonb));
$$;

-- Revoke one session: own sessions, or anyone's with sessions.revoke.
create or replace function public.revoke_session(p_session uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.user_sessions;
begin
  if not public.session_active() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.user_sessions where id = p_session for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if s.user_id <> auth.uid() and not public.has_permission('sessions.revoke') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if s.status in ('revoked', 'signed_out') then return; end if;
  update public.user_sessions
     set status = 'revoked', ended_at = now(), revoked_by = auth.uid(), revoke_reason = left(p_reason, 200)
   where id = p_session;
  -- Also end the refresh-token family when the platform allows it.
  begin
    execute 'delete from auth.sessions where id = $1' using p_session;
  exception when others then
    null;   -- the registry status alone already blocks every data access
  end;
  insert into public.login_events (event, user_id, session_id, reason)
  values ('session_revoked', s.user_id, s.id, case when s.user_id = auth.uid() then 'self' else 'admin' end);
  perform public.log_security_event('session.revoked', case when s.user_id = auth.uid() then 'info' else 'warning' end,
    'Session revoked', s.user_id, jsonb_build_object('session_id', s.id, 'by_admin', s.user_id <> auth.uid()));
  if s.user_id <> auth.uid() then
    perform public.notify_user(s.user_id, 'session_revoked', 'A session was signed out by an administrator',
      concat_ws(' / ', s.browser, s.os), jsonb_build_object('session_id', s.id), '/settings/security', null, 'session', s.id);
  end if;
end;
$$;

create or replace function public.revoke_other_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public.current_session_id();
  r record;
  v_n integer := 0;
begin
  if not public.session_active() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  for r in select id from public.user_sessions
            where user_id = auth.uid() and id <> v_sid and status in ('active', 'pending_otp') loop
    perform public.revoke_session(r.id, 'sign_out_others');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Normal sign-out of the current session.
create or replace function public.end_current_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public.current_session_id();
begin
  update public.user_sessions set status = 'signed_out', ended_at = now()
   where id = v_sid and user_id = auth.uid() and status in ('active', 'pending_otp');
  if found then
    insert into public.login_events (event, user_id, session_id) values ('logout', auth.uid(), v_sid);
  end if;
end;
$$;

-- Atomic fixed-window counter. true = allowed.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as rl (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
     set hits = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.hits + 1 end,
         window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Rate limit usable by signed-in users for their own actions (key is
-- namespaced with the user id so it cannot be used against others).
create or replace function public.user_rate_limit(p_action text, p_limit integer, p_window_seconds integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  select case when auth.uid() is null then false
         else public.rate_limit_hit('u:' || auth.uid() || ':' || left(p_action, 40), p_limit, p_window_seconds) end;
$$;

-- Security settings changes are themselves security events.
create or replace function public.tg_security_settings_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary text;
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'auth_security_settings' then
    v_summary := 'Authentication / OTP policy changed';
    v_meta := jsonb_build_object('otp_mode', to_jsonb(new) ->> 'otp_mode', 'otp_scope', to_jsonb(new) ->> 'otp_scope');
  else
    v_summary := 'OTP role requirements changed';
    v_meta := jsonb_build_object('role_id', coalesce(to_jsonb(new), to_jsonb(old)) ->> 'role_id', 'op', lower(tg_op));
  end if;
  perform public.log_security_event('security.config_changed', 'warning', v_summary, null, v_meta);
  perform public.notify_permission('security.manage', 'security_config_changed', 'Security configuration changed',
    null, '{}'::jsonb, '/admin/security', null, 'security', null, auth.uid());
  return coalesce(new, old);
end;
$$;
create trigger auth_security_settings_event after update on public.auth_security_settings
  for each row when (old.* is distinct from new.*) execute function public.tg_security_settings_event();
create trigger otp_role_requirements_event after insert or delete on public.otp_role_requirements
  for each row execute function public.tg_security_settings_event();
create trigger auth_security_settings_touch before insert or update on public.auth_security_settings
  for each row execute function public.tg_touch_row();
create trigger auth_security_settings_audit after insert or update or delete on public.auth_security_settings
  for each row execute function public.tg_audit('id');

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.auth_security_settings enable row level security;
create policy auth_security_settings_read on public.auth_security_settings for select to authenticated using (true);
create policy auth_security_settings_update on public.auth_security_settings for update to authenticated
  using (public.has_permission('security.manage')) with check (public.has_permission('security.manage'));

alter table public.otp_role_requirements enable row level security;
create policy otp_role_requirements_read on public.otp_role_requirements for select to authenticated using (true);
create policy otp_role_requirements_insert on public.otp_role_requirements for insert to authenticated
  with check (public.has_permission('security.manage'));
create policy otp_role_requirements_delete on public.otp_role_requirements for delete to authenticated
  using (public.has_permission('security.manage'));

alter table public.user_sessions enable row level security;
create policy user_sessions_select on public.user_sessions for select to authenticated
  using ((user_id = auth.uid() and public.session_active()) or public.has_permission('sessions.view'));
revoke insert, update, delete, truncate on public.user_sessions from anon, authenticated;

alter table public.trusted_devices enable row level security;
create policy trusted_devices_select on public.trusted_devices for select to authenticated
  using (user_id = auth.uid() and public.session_active());
revoke insert, delete, truncate on public.trusted_devices from anon, authenticated;
revoke update on public.trusted_devices from anon, authenticated;
grant update (revoked_at) on public.trusted_devices to authenticated;
create policy trusted_devices_revoke on public.trusted_devices for update to authenticated
  using (user_id = auth.uid() and public.session_active()) with check (user_id = auth.uid());

alter table public.login_events enable row level security;
create policy login_events_select on public.login_events for select to authenticated
  using ((user_id = auth.uid() and public.session_active()) or public.has_permission('security.view'));
revoke insert, update, delete, truncate on public.login_events from anon, authenticated;

alter table public.security_events enable row level security;
create policy security_events_select on public.security_events for select to authenticated
  using (public.has_permission('security.view') or (target_user_id = auth.uid() and public.session_active()));
revoke insert, update, delete, truncate on public.security_events from anon, authenticated;

alter table public.otp_challenges enable row level security;   -- server only
revoke all on public.otp_challenges from anon, authenticated;
alter table public.rate_limits enable row level security;      -- server only
revoke all on public.rate_limits from anon, authenticated;

revoke execute on function public.register_session(text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.current_session_state() from public, anon;
revoke execute on function public.revoke_session(uuid, text) from public, anon;
revoke execute on function public.revoke_other_sessions() from public, anon;
revoke execute on function public.end_current_session() from public, anon;
revoke execute on function public.user_rate_limit(text, integer, integer) from public, anon;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.log_security_event(text, text, text, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.session_activated(uuid) from public, anon, authenticated;
revoke execute on function public.otp_required_for(uuid, text) from public, anon, authenticated;
grant execute on function public.register_session(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.current_session_state() to authenticated;
grant execute on function public.revoke_session(uuid, text) to authenticated;
grant execute on function public.revoke_other_sessions() to authenticated;
grant execute on function public.end_current_session() to authenticated;
grant execute on function public.user_rate_limit(text, integer, integer) to authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.log_security_event(text, text, text, uuid, jsonb, uuid, text) to service_role;
grant execute on function public.session_activated(uuid) to service_role;
grant execute on function public.otp_required_for(uuid, text) to service_role;

-- Housekeeping (expired OTP challenges / rate-limit windows).
create or replace function public.security_housekeeping()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.otp_challenges where created_at < now() - interval '2 days';
  delete from public.rate_limits where window_start < now() - interval '1 day';
  update public.trusted_devices set revoked_at = now() where revoked_at is null and expires_at < now();
$$;
revoke execute on function public.security_housekeeping() from public, anon, authenticated;
grant execute on function public.security_housekeeping() to service_role;

-- Realtime: sessions list updates live.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'user_sessions') then
    alter publication supabase_realtime add table public.user_sessions;
  end if;
end;
$$;
