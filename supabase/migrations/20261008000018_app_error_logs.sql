-- =====================================================================
-- 0018 SERVER ERROR LOG (additive)
-- ---------------------------------------------------------------------
-- When a page fails, the user only sees a reference number (the digest).
-- The real error is written here by the server (service role) so an
-- administrator can find it. No request bodies, cookies or patient data
-- are stored — only the error, the route and the digest.
-- =====================================================================
create table public.app_error_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  digest text check (length(digest) <= 100),
  message text check (length(message) <= 2000),
  stack text check (length(stack) <= 8000),
  path text check (length(path) <= 500),
  method text check (length(method) <= 10),
  route_path text check (length(route_path) <= 300),
  route_type text check (length(route_type) <= 30),
  render_source text check (length(render_source) <= 60)
);
create index app_error_logs_occurred_idx on public.app_error_logs(occurred_at desc);
create index app_error_logs_digest_idx on public.app_error_logs(digest);

alter table public.app_error_logs enable row level security;
create policy app_error_logs_select on public.app_error_logs for select to authenticated
  using (public.has_permission('audit.view'));
-- Written by the server only (service role); never by browsers.
revoke insert, update, delete, truncate on public.app_error_logs from anon, authenticated;
create trigger app_error_logs_immutable before update or delete on public.app_error_logs
  for each row execute function public.tg_audit_logs_immutable();
