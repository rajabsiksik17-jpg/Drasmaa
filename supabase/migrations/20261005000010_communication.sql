-- =====================================================================
-- 0010 COMMUNICATION: permissions, patient contact fields, notification
-- engine (catalog, preferences, priority), message templates with
-- versions, email account metadata (secrets encrypted by the app server),
-- communication log, appointment reminder engine and email outbox.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, group_code, description_en, description_ar, sort_order) values
  ('settings.email.view',       'communication', 'View email configuration and diagnostics',  'عرض إعدادات البريد والتشخيص', 100),
  ('settings.email.manage',     'communication', 'Configure the clinic email account',        'إعداد حساب البريد للعيادة', 101),
  ('notifications.view',        'communication', 'Use the notification center',               'استخدام مركز الإشعارات', 102),
  ('notifications.manage',      'communication', 'Configure clinic notifications and reminders', 'إعداد الإشعارات والتذكيرات', 103),
  ('templates.view',            'communication', 'View message templates',                    'عرض قوالب الرسائل', 104),
  ('templates.create',          'communication', 'Create message templates',                  'إنشاء قوالب الرسائل', 105),
  ('templates.edit',            'communication', 'Edit message and document templates',       'تعديل قوالب الرسائل والمستندات', 106),
  ('templates.delete',          'communication', 'Archive message templates',                 'أرشفة قوالب الرسائل', 107),
  ('messages.send',             'communication', 'Message patients',                          'مراسلة المرضى', 108),
  ('messages.send_email',       'communication', 'Send emails to patients',                   'إرسال بريد إلكتروني للمرضى', 109),
  ('messages.prepare_whatsapp', 'communication', 'Prepare WhatsApp messages',                 'تجهيز رسائل واتساب', 110),
  ('security.view',             'security',      'View the security center',                  'عرض مركز الأمان', 120),
  ('security.manage',           'security',      'Manage authentication, OTP and security policy', 'إدارة المصادقة ورمز التحقق وسياسة الأمان', 121),
  ('sessions.view',             'security',      'View all users'' sessions',                  'عرض جلسات جميع المستخدمين', 122),
  ('sessions.revoke',           'security',      'Revoke other users'' sessions',              'إنهاء جلسات المستخدمين', 123),
  ('documents.generate',        'documents',     'Generate PDF documents',                    'إنشاء مستندات PDF', 73),
  ('documents.share',           'documents',     'Share generated documents (WhatsApp / email)', 'مشاركة المستندات المُنشأة', 74),
  ('documents.delete',          'documents',     'Delete generated documents',                'حذف المستندات المُنشأة', 75)
on conflict (code) do nothing;

-- Administrator: everything (including the new codes).
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p where r.code = 'admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in (
  'notifications.view', 'templates.view', 'messages.send', 'messages.send_email', 'messages.prepare_whatsapp',
  'documents.generate', 'documents.share'
)
where r.code in ('doctor', 'receptionist')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Patient contact preferences
-- ---------------------------------------------------------------------
alter table public.patients
  add column if not exists email text check (email is null or email ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$'),
  add column if not exists whatsapp_phone text,
  add column if not exists preferred_language text not null default 'ar' check (preferred_language in ('ar', 'en'));

-- Doctor details printed on documents. The signature image lives in the
-- private bucket and is only used when the doctor generates a document.
alter table public.doctors
  add column if not exists title_en text,
  add column if not exists title_ar text,
  add column if not exists signature_path text;

-- WhatsApp + document settings (clinic-wide, simple scalar settings).
alter table public.clinic_settings
  add column if not exists whatsapp_enabled boolean not null default true,
  add column if not exists whatsapp_country_code text not null default '962' check (whatsapp_country_code ~ '^[1-9][0-9]{0,3}$'),
  add column if not exists whatsapp_open_mode text not null default 'auto' check (whatsapp_open_mode in ('auto', 'web', 'app')),
  add column if not exists generated_document_retention_days integer check (generated_document_retention_days between 1 and 36500);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.profiles_with_permission(p_code text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select pr.id
    from public.profiles pr
    join public.roles r on r.id = pr.role_id and r.active
    join public.role_permissions rp on rp.role_id = pr.role_id and rp.permission_code = p_code
   where pr.active;
$$;
revoke execute on function public.profiles_with_permission(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Notification catalog (clinic-level configuration)
-- ---------------------------------------------------------------------
create table public.notification_event_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  category text not null check (category in ('appointments', 'patients', 'medical', 'system', 'security', 'admin')),
  default_priority text not null default 'normal' check (default_priority in ('low', 'normal', 'high', 'critical')),
  name_en text not null,
  name_ar text not null,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  -- Critical events always reach the in-app center and cannot be muted.
  is_critical boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint notification_event_types_critical check (not is_critical or in_app_enabled)
);

insert into public.notification_event_types (code, category, default_priority, name_en, name_ar, is_critical, email_enabled, sort_order) values
  ('appointment_created',      'appointments', 'normal',   'New appointment',               'موعد جديد', false, false, 1),
  ('appointment_approaching',  'appointments', 'high',     'Appointment approaching',       'موعد قريب', false, false, 2),
  ('appointment_reminder',     'appointments', 'normal',   'Appointment tomorrow',          'موعد الغد', false, false, 3),
  ('appointment_cancelled',    'appointments', 'normal',   'Appointment cancelled',         'إلغاء موعد', false, false, 4),
  ('appointment_rescheduled',  'appointments', 'normal',   'Appointment rescheduled',       'إعادة جدولة موعد', false, false, 5),
  ('patient_checked_in',       'appointments', 'high',     'Patient checked in / waiting',  'وصول مريضة / بالانتظار', false, false, 6),
  ('appointment_missed',       'appointments', 'normal',   'Patient missed appointment',    'لم تحضر المريضة', false, false, 7),
  ('whatsapp_reminder_ready',  'appointments', 'normal',   'WhatsApp reminder ready',       'تذكير واتساب جاهز', false, false, 8),
  ('patient_registered',       'patients',     'normal',   'New patient registered',        'تسجيل مريضة جديدة', false, false, 20),
  ('patient_assigned',         'patients',     'normal',   'Patient assigned to doctor',    'إسناد مريضة لطبيب', false, false, 21),
  ('pregnancy_followup_due',   'medical',      'normal',   'Pregnancy follow-up due',       'متابعة حمل مستحقة', false, false, 30),
  ('fertility_followup_due',   'medical',      'normal',   'Fertility follow-up due',       'متابعة خصوبة مستحقة', false, false, 31),
  ('investigation_uploaded',   'medical',      'normal',   'Investigation uploaded',        'رفع نتيجة فحص', false, false, 32),
  ('user_created',             'admin',        'normal',   'New user',                      'مستخدم جديد', false, false, 40),
  ('user_status_changed',      'admin',        'high',     'User activated / deactivated',  'تفعيل / تعطيل مستخدم', false, false, 41),
  ('permission_changed',       'admin',        'high',     'Permission changed',            'تغيير صلاحية', false, false, 42),
  ('doctor_added',             'admin',        'normal',   'Doctor added',                  'إضافة طبيب', false, false, 43),
  ('doctor_removed',           'admin',        'normal',   'Doctor deactivated',            'تعطيل طبيب', false, false, 44),
  ('config_changed',           'admin',        'normal',   'Configuration changed',         'تغيير الإعدادات', false, false, 45),
  ('new_login',                'security',     'high',     'New login detected',            'تسجيل دخول جديد', true, false, 60),
  ('otp_verified',             'security',     'low',      'OTP login completed',           'اكتمال الدخول برمز التحقق', false, false, 61),
  ('login_failed',             'security',     'critical', 'Suspicious login attempts',     'محاولات دخول مشبوهة', true, true, 62),
  ('session_revoked',          'security',     'high',     'Session revoked',               'إنهاء جلسة', true, false, 63),
  ('password_changed',         'security',     'high',     'Password changed',              'تغيير كلمة المرور', true, true, 64),
  ('security_config_changed',  'security',     'critical', 'Security configuration changed','تغيير إعدادات الأمان', true, true, 65),
  ('email_failure',            'system',       'high',     'Email failure',                 'فشل البريد الإلكتروني', false, false, 80),
  ('system',                   'system',       'normal',   'System message',                'رسالة النظام', false, false, 90)
on conflict (code) do nothing;

create table public.user_notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_code text not null references public.notification_event_types(code) on delete cascade,
  in_app boolean not null default true,
  email boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_code)
);

-- ---------------------------------------------------------------------
-- Notifications: category, priority, link, FK to the catalog
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add column if not exists category text check (category in ('appointments', 'patients', 'medical', 'system', 'security', 'admin')),
  add column if not exists priority text check (priority in ('low', 'normal', 'high', 'critical')),
  add column if not exists link text check (link is null or (link ~ '^/[A-Za-z0-9/_?=&.%-]*$' and link !~ '//'));
update public.notifications n
   set category = e.category, priority = e.default_priority
  from public.notification_event_types e
 where e.code = n.type and n.category is null;
-- No column defaults: NULL means "use the catalog" (filled by the routing trigger).
alter table public.notifications
  add constraint notifications_type_fk foreign key (type) references public.notification_event_types(code);
create index if not exists notifications_recipient_unread_created_idx
  on public.notifications(recipient_id, created_at desc) where read_at is null and voided_at is null;

-- ---------------------------------------------------------------------
-- Email outbox (server-side queue; never readable by clients)
-- ---------------------------------------------------------------------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,                     -- template purpose / notification / reminder
  to_address text not null check (to_address ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$'),
  locale text not null default 'en' check (locale in ('en', 'ar')),
  notification_id uuid,
  communication_log_id uuid,
  variables jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_due_idx on public.email_outbox(next_attempt_at) where status = 'queued';
alter table public.email_outbox enable row level security;   -- no policies: service role only
revoke all on public.email_outbox from anon, authenticated;

-- Defaults from the catalog, admin switches, per-user mutes, email fan-out.
create or replace function public.tg_notifications_route()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.notification_event_types;
  pref public.user_notification_preferences;
  v_email text;
  v_locale text;
begin
  select * into e from public.notification_event_types where code = new.type;
  if not found then
    raise exception 'Unknown notification type %', new.type using errcode = '23503';
  end if;
  new.category := e.category;
  new.priority := coalesce(new.priority, e.default_priority);
  if e.is_critical then
    new.priority := case when new.priority in ('low', 'normal') then 'high' else new.priority end;
  end if;

  select * into pref from public.user_notification_preferences
   where user_id = new.recipient_id and event_code = new.type;

  if e.email_enabled and (e.is_critical or coalesce(pref.email, true)) then
    select email, locale into v_email, v_locale from public.profiles where id = new.recipient_id and active;
    if v_email is not null and v_email ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$' then
      insert into public.email_outbox (purpose, to_address, locale, notification_id, variables)
      values ('notification', v_email, coalesce(v_locale, 'en'), new.id,
              jsonb_build_object('type', new.type, 'title', new.title, 'message', coalesce(new.message, ''),
                                 'link', coalesce(new.link, ''), 'data', new.data));
    end if;
  end if;

  if not e.is_critical and (not e.in_app_enabled or pref.in_app = false) then
    return null;   -- muted in-app (email, if any, is already queued)
  end if;
  return new;
end;
$$;
create trigger notifications_route before insert on public.notifications
  for each row execute function public.tg_notifications_route();

-- Generic emitters (security definer; called from triggers / server).
create or replace function public.notify_user(
  p_recipient uuid, p_type text, p_title text, p_message text default null,
  p_data jsonb default '{}'::jsonb, p_link text default null,
  p_patient uuid default null, p_entity_type text default null, p_entity_id uuid default null,
  p_priority text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then return; end if;
  insert into public.notifications (recipient_id, type, title, message, data, link, patient_id, entity_type, entity_id, priority)
  values (p_recipient, p_type, p_title, p_message, coalesce(p_data, '{}'::jsonb), p_link, p_patient, p_entity_type, p_entity_id, p_priority);
end;
$$;

create or replace function public.notify_permission(
  p_permission text, p_type text, p_title text, p_message text default null,
  p_data jsonb default '{}'::jsonb, p_link text default null,
  p_patient uuid default null, p_entity_type text default null, p_entity_id uuid default null,
  p_exclude uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in select public.profiles_with_permission(p_permission) loop
    if v_id is distinct from p_exclude then
      perform public.notify_user(v_id, p_type, p_title, p_message, p_data, p_link, p_patient, p_entity_type, p_entity_id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.notify_user(uuid, text, text, text, jsonb, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.notify_permission(text, text, text, text, jsonb, text, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.notify_user(uuid, text, text, text, jsonb, text, uuid, text, uuid, text) to service_role;
grant execute on function public.notify_permission(text, text, text, text, jsonb, text, uuid, text, uuid, uuid) to service_role;

-- Patient → assigned doctor's login (if any).
create or replace function public.patient_doctor_profile(p_patient uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.profile_id from public.patients p join public.doctors d on d.id = p.assigned_doctor_id
   where p.id = p_patient and d.active;
$$;

-- ---------------------------------------------------------------------
-- Event triggers (administrative / patient / medical events).
-- Notification text carries no clinical details (privacy).
-- ---------------------------------------------------------------------
create or replace function public.tg_patients_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_data jsonb := jsonb_build_object('patient_id', new.id, 'patient_name', new.full_name, 'patient_code', new.patient_code);
begin
  if tg_op = 'INSERT' or new.assigned_doctor_id is distinct from old.assigned_doctor_id then
    v_profile := public.patient_doctor_profile(new.id);
    if v_profile is not null and v_profile is distinct from auth.uid() then
      perform public.notify_user(v_profile,
        case when tg_op = 'INSERT' then 'patient_registered' else 'patient_assigned' end,
        case when tg_op = 'INSERT' then 'New patient registered' else 'Patient assigned to you' end,
        new.full_name || ' — ' || new.patient_code, v_data, '/patients/' || new.id, new.id, 'patient', new.id);
    end if;
  end if;
  return new;
end;
$$;
create trigger patients_notify after insert or update of assigned_doctor_id on public.patients
  for each row execute function public.tg_patients_notify();

create or replace function public.tg_documents_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.patient_doctor_profile(new.patient_id);
  v_p public.patients;
begin
  if new.category = 'investigation' and v_profile is not null and v_profile is distinct from auth.uid() then
    select * into v_p from public.patients where id = new.patient_id;
    perform public.notify_user(v_profile, 'investigation_uploaded', 'Investigation uploaded',
      v_p.full_name || ' — ' || v_p.patient_code,
      jsonb_build_object('patient_id', v_p.id, 'patient_name', v_p.full_name, 'patient_code', v_p.patient_code),
      '/patients/' || v_p.id || '?tab=documents', v_p.id, 'document', new.id);
  end if;
  return new;
end;
$$;
create trigger documents_notify after insert on public.documents
  for each row execute function public.tg_documents_notify();

create or replace function public.tg_appointments_notify_extra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'no_show' and old.status is distinct from 'no_show' then
    perform public.notify_doctor(new.id, 'appointment_missed', 'Patient missed appointment');
  end if;
  return new;
end;
$$;
create trigger appointments_notify_extra after update of status on public.appointments
  for each row execute function public.tg_appointments_notify_extra();

create or replace function public.tg_admin_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      perform public.notify_permission('users.manage', 'user_created', 'New user',
        coalesce(nullif(new.full_name, ''), new.email), jsonb_build_object('user_id', new.id), '/admin/users', null, 'profile', new.id, v_actor);
    elsif new.active is distinct from old.active then
      perform public.notify_permission('users.manage', 'user_status_changed',
        case when new.active then 'User activated' else 'User deactivated' end,
        coalesce(nullif(new.full_name, ''), new.email), jsonb_build_object('user_id', new.id, 'active', new.active),
        '/admin/users', null, 'profile', new.id, v_actor);
    elsif new.role_id is distinct from old.role_id then
      perform public.notify_permission('users.manage', 'permission_changed', 'User role changed',
        coalesce(nullif(new.full_name, ''), new.email), jsonb_build_object('user_id', new.id), '/admin/users', null, 'profile', new.id, v_actor);
    end if;
    return new;
  elsif tg_table_name = 'doctors' then
    if tg_op = 'INSERT' then
      perform public.notify_permission('settings.manage', 'doctor_added', 'Doctor added', new.display_name_en,
        jsonb_build_object('doctor_id', new.id), '/admin/doctors', null, 'doctor', new.id, v_actor);
    elsif new.active is distinct from old.active and not new.active then
      perform public.notify_permission('settings.manage', 'doctor_removed', 'Doctor deactivated', new.display_name_en,
        jsonb_build_object('doctor_id', new.id), '/admin/doctors', null, 'doctor', new.id, v_actor);
    end if;
    return new;
  elsif tg_table_name = 'role_permissions' then
    perform public.notify_permission('roles.manage', 'permission_changed',
      case when tg_op = 'INSERT' then 'Permission granted' else 'Permission removed' end,
      (select coalesce(r.name_en, '') from public.roles r where r.id = coalesce(new.role_id, old.role_id)) || ': ' ||
        coalesce(new.permission_code, old.permission_code),
      jsonb_build_object('permission', coalesce(new.permission_code, old.permission_code)),
      '/admin/roles', null, 'role', coalesce(new.role_id, old.role_id), v_actor);
    return coalesce(new, old);
  elsif tg_table_name = 'clinic_settings' then
    perform public.notify_permission('settings.manage', 'config_changed', 'Clinic settings changed', null,
      '{}'::jsonb, '/admin/clinic', null, 'clinic_settings', null, v_actor);
    return new;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger profiles_admin_notify after insert or update of active, role_id on public.profiles
  for each row execute function public.tg_admin_notify();
create trigger doctors_admin_notify after insert or update of active on public.doctors
  for each row execute function public.tg_admin_notify();
create trigger role_permissions_admin_notify after insert or delete on public.role_permissions
  for each row execute function public.tg_admin_notify();
create trigger clinic_settings_admin_notify after update on public.clinic_settings
  for each row when (old.* is distinct from new.*) execute function public.tg_admin_notify();

-- ---------------------------------------------------------------------
-- Message templates (email + WhatsApp) with immutable versions
-- ---------------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  code text unique check (code ~ '^[a-z][a-z0-9_]*$'),   -- built-in templates only
  channel text not null check (channel in ('email', 'whatsapp')),
  category text not null check (category in ('appointment', 'medical_followup', 'pregnancy', 'fertility', 'ivf',
                                             'general', 'congratulations', 'administrative', 'security', 'documents', 'custom')),
  -- What the system auto-selects it for (appointment_reminder, document_share, otp_code, ...).
  purpose text not null default 'custom' check (purpose ~ '^[a-z][a-z0-9_]*$'),
  name_en text not null check (length(btrim(name_en)) between 1 and 120),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 120),
  subject_en text check (subject_en is null or length(subject_en) <= 200),
  subject_ar text check (subject_ar is null or length(subject_ar) <= 200),
  body_en text not null default '' check (length(body_en) <= 10000),
  body_ar text not null default '' check (length(body_ar) <= 10000),
  default_language text not null default 'ar' check (default_language in ('ar', 'en')),
  active boolean not null default true,
  is_system boolean not null default false,
  archived_at timestamptz,
  archived_by uuid,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  -- Email subjects can never carry header injection.
  constraint message_templates_subject_single_line
    check (coalesce(subject_en, '') !~ '[\r\n]' and coalesce(subject_ar, '') !~ '[\r\n]')
);
create index message_templates_lookup_idx on public.message_templates(channel, purpose) where archived_at is null;

create table public.message_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.message_templates(id) on delete cascade,
  version_no integer not null,
  name_en text not null,
  name_ar text not null,
  subject_en text,
  subject_ar text,
  body_en text not null,
  body_ar text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (template_id, version_no)
);

create or replace function public.tg_message_templates_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code or new.is_system is distinct from old.is_system
       or new.channel is distinct from old.channel then
      raise exception 'Template channel and identity cannot change.' using errcode = '42501';
    end if;
    if new.archived_at is distinct from old.archived_at and auth.uid() is not null then
      if old.is_system and new.archived_at is not null then
        raise exception 'Built-in templates can be deactivated, not deleted.' using errcode = '42501';
      end if;
      if not public.has_permission('templates.delete') then
        raise exception 'You are not allowed to delete templates.' using errcode = '42501';
      end if;
      new.archived_by := auth.uid();
    end if;
  elsif new.is_system and auth.uid() is not null then
    raise exception 'Built-in templates are created by the system only.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger message_templates_guard before insert or update on public.message_templates
  for each row execute function public.tg_message_templates_guard();

create or replace function public.tg_message_templates_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or (new.name_en, new.name_ar, new.subject_en, new.subject_ar, new.body_en, new.body_ar)
        is distinct from (old.name_en, old.name_ar, old.subject_en, old.subject_ar, old.body_en, old.body_ar) then
    insert into public.message_template_versions
      (template_id, version_no, name_en, name_ar, subject_en, subject_ar, body_en, body_ar, created_by)
    values (new.id, coalesce((select max(version_no) from public.message_template_versions where template_id = new.id), 0) + 1,
            new.name_en, new.name_ar, new.subject_en, new.subject_ar, new.body_en, new.body_ar, auth.uid());
  end if;
  return new;
end;
$$;
create trigger message_templates_version after insert or update on public.message_templates
  for each row execute function public.tg_message_templates_version();

-- Restore = copy an old version back (creating a new version; nothing is lost).
create or replace function public.restore_message_template_version(p_version uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.message_template_versions;
begin
  select * into v from public.message_template_versions where id = p_version;
  if not found then
    raise exception 'Version not found.' using errcode = 'P0002';
  end if;
  update public.message_templates
     set name_en = v.name_en, name_ar = v.name_ar, subject_en = v.subject_en, subject_ar = v.subject_ar,
         body_en = v.body_en, body_ar = v.body_ar
   where id = v.template_id;
  if not found then
    raise exception 'Template not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Email account (metadata). Passwords are AES-256-GCM ciphertext created
-- by the application server; authenticated users can never select them.
-- ---------------------------------------------------------------------
create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  is_default boolean not null default true,
  email_address text not null check (email_address ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$'),
  display_name text not null check (length(display_name) <= 120 and display_name !~ '[\r\n<>"]'),
  smtp_host text not null check (smtp_host ~ '^[A-Za-z0-9.-]+$'),
  smtp_port integer not null check (smtp_port between 1 and 65535),
  smtp_security text not null check (smtp_security in ('ssl', 'tls', 'starttls', 'none')),
  smtp_username text not null check (length(smtp_username) <= 200),
  smtp_password_enc text,
  imap_enabled boolean not null default false,
  imap_host text check (imap_host is null or imap_host ~ '^[A-Za-z0-9.-]+$'),
  imap_port integer check (imap_port between 1 and 65535),
  imap_security text check (imap_security in ('ssl', 'tls', 'starttls', 'none')),
  imap_username text check (length(imap_username) <= 200),
  imap_password_enc text,
  smtp_status text not null default 'unknown' check (smtp_status in ('unknown', 'ok', 'failed')),
  imap_status text not null default 'unknown' check (imap_status in ('unknown', 'ok', 'failed', 'disabled')),
  last_test_at timestamptz,
  last_success_email_at timestamptz,
  last_failed_email_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create unique index email_accounts_default_idx on public.email_accounts(is_default) where is_default;

alter table public.email_accounts enable row level security;
create policy email_accounts_select on public.email_accounts for select to authenticated
  using (public.has_permission('settings.email.view') or public.has_permission('settings.email.manage'));
-- Column-level privileges: ciphertext columns are never selectable by clients.
revoke all on public.email_accounts from anon, authenticated;
grant select (id, is_default, email_address, display_name, smtp_host, smtp_port, smtp_security, smtp_username,
              imap_enabled, imap_host, imap_port, imap_security, imap_username, smtp_status, imap_status,
              last_test_at, last_success_email_at, last_failed_email_at, last_error_code,
              created_at, updated_at, created_by, updated_by, version)
  on public.email_accounts to authenticated;

create table public.email_connection_tests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.email_accounts(id) on delete cascade,
  tested_by uuid references public.profiles(id),
  tested_at timestamptz not null default now(),
  smtp_connected boolean,
  smtp_authenticated boolean,
  smtp_test_sent boolean,
  imap_connected boolean,
  imap_authenticated boolean,
  error_code text,
  duration_ms integer
);
create index email_connection_tests_idx on public.email_connection_tests(account_id, tested_at desc);
alter table public.email_connection_tests enable row level security;
create policy email_connection_tests_select on public.email_connection_tests for select to authenticated
  using (public.has_permission('settings.email.view') or public.has_permission('settings.email.manage'));
revoke insert, update, delete, truncate on public.email_connection_tests from anon, authenticated;

-- ---------------------------------------------------------------------
-- Communication log (per patient / appointment / generated document)
-- ---------------------------------------------------------------------
create table public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id),
  appointment_id uuid references public.appointments(id),
  generated_document_id uuid,                -- FK added in 0012
  channel text not null check (channel in ('whatsapp', 'email', 'in_app', 'system')),
  purpose text not null default 'custom',
  template_id uuid references public.message_templates(id),
  template_version integer,
  recipient_type text check (recipient_type in ('patient', 'husband', 'custom', 'staff')),
  recipient text not null check (length(recipient) <= 320),
  language text check (language in ('ar', 'en')),
  subject text check (subject is null or (length(subject) <= 200 and subject !~ '[\r\n]')),
  body text check (length(body) <= 10000),
  -- WhatsApp without a provider can only be prepared/opened, never "delivered".
  status text not null check (status in ('prepared', 'opened', 'queued', 'sent', 'failed', 'skipped')),
  error_code text,
  automated boolean not null default false,
  performed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  sent_at timestamptz,
  constraint communication_logs_whatsapp_status check (channel <> 'whatsapp' or status in ('prepared', 'opened', 'skipped'))
);
create index communication_logs_patient_idx on public.communication_logs(patient_id, created_at desc);
create index communication_logs_appointment_idx on public.communication_logs(appointment_id, created_at desc);

alter table public.communication_logs enable row level security;
create policy communication_logs_select on public.communication_logs for select to authenticated
  using (
    case when patient_id is null
      then performed_by = auth.uid() or public.has_permission('security.view')
      else public.can_access_patient(patient_id)
    end
  );
create policy communication_logs_insert on public.communication_logs for insert to authenticated
  with check (
    performed_by = auth.uid()
    and not automated
    and public.has_permission('messages.send')
    and (patient_id is null or public.can_access_patient(patient_id))
    and case channel
          when 'whatsapp' then public.has_permission('messages.prepare_whatsapp') and status = 'prepared'
          when 'email' then public.has_permission('messages.send_email') and status = 'queued'
          else false
        end
  );
create policy communication_logs_update on public.communication_logs for update to authenticated
  using (performed_by = auth.uid()) with check (performed_by = auth.uid());
revoke delete, truncate on public.communication_logs from anon, authenticated;

-- Users may only mark their own prepared WhatsApp message as opened;
-- everything else is written by the server (service role).
create or replace function public.tg_communication_logs_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'opened_at') is distinct from (to_jsonb(old) - 'status' - 'opened_at')
     or not (old.channel = 'whatsapp' and old.status in ('prepared', 'opened') and new.status = 'opened') then
    raise exception 'Communication history cannot be changed.' using errcode = '42501';
  end if;
  new.opened_at := coalesce(old.opened_at, now());
  return new;
end;
$$;
create trigger communication_logs_guard before update on public.communication_logs
  for each row execute function public.tg_communication_logs_guard();

-- ---------------------------------------------------------------------
-- Appointment reminder engine (configurable offsets and channels)
-- ---------------------------------------------------------------------
create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  offset_minutes integer not null check (offset_minutes between 15 and 10080),
  channel text not null check (channel in ('in_app', 'email', 'whatsapp_prepare')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (offset_minutes, channel)
);
insert into public.reminder_rules (offset_minutes, channel, enabled) values
  (1440, 'email', false), (720, 'email', false), (120, 'email', false), (60, 'email', false),
  (1440, 'in_app', false), (120, 'in_app', false), (60, 'in_app', true),
  (1440, 'whatsapp_prepare', false), (120, 'whatsapp_prepare', false)
on conflict do nothing;

create table public.appointment_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  rule_id uuid not null references public.reminder_rules(id) on delete cascade,
  channel text not null,
  status text not null check (status in ('pending', 'processing', 'sent', 'failed', 'skipped', 'prepared')),
  reason text,
  communication_log_id uuid references public.communication_logs(id),
  due_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (appointment_id, rule_id)
);
create index appointment_reminder_deliveries_pending_idx on public.appointment_reminder_deliveries(status) where status = 'pending';
alter table public.appointment_reminder_deliveries enable row level security;
create policy appointment_reminder_deliveries_select on public.appointment_reminder_deliveries for select to authenticated
  using (public.has_permission('appointments.view')
         and exists (select 1 from public.appointments a where a.id = appointment_id));
revoke insert, update, delete, truncate on public.appointment_reminder_deliveries from anon, authenticated;

-- Creates due deliveries. Per appointment and channel only the latest due
-- threshold fires (earlier, missed thresholds are skipped, never batched),
-- and thresholds that passed before the booking was made are skipped.
create or replace function public.queue_due_appointment_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_payload jsonb;
  v_n integer := 0;
  v_profile uuid;
  v_title text;
begin
  for r in
    with due as (
      select a.id as appointment_id, a.created_at as booked_at, a.scheduled_at, a.patient_id, a.doctor_id, a.visit_type,
             rr.id as rule_id, rr.channel, rr.offset_minutes,
             a.scheduled_at - make_interval(mins => rr.offset_minutes) as due_at,
             row_number() over (partition by a.id, rr.channel order by rr.offset_minutes asc) as rn
        from public.appointments a
        join public.reminder_rules rr on rr.enabled
       where a.status = 'scheduled'
         and a.scheduled_at > now()
         and a.scheduled_at - make_interval(mins => rr.offset_minutes) <= now()
         and a.scheduled_at <= now() + interval '8 days'
    )
    select d.* from due d
     where not exists (select 1 from public.appointment_reminder_deliveries x
                        where x.appointment_id = d.appointment_id and x.rule_id = d.rule_id)
     order by d.scheduled_at
  loop
    if r.rn > 1 or r.due_at < r.booked_at - interval '1 minute' or exists (
         select 1 from public.appointment_reminder_deliveries x
           join public.reminder_rules rx on rx.id = x.rule_id
          where x.appointment_id = r.appointment_id and x.channel = r.channel and rx.offset_minutes < r.offset_minutes) then
      insert into public.appointment_reminder_deliveries (appointment_id, rule_id, channel, status, reason, due_at, processed_at)
      values (r.appointment_id, r.rule_id, r.channel, 'skipped', 'superseded', r.due_at, now())
      on conflict do nothing;
      continue;
    end if;

    if r.channel = 'email' then
      insert into public.appointment_reminder_deliveries (appointment_id, rule_id, channel, status, due_at)
      values (r.appointment_id, r.rule_id, r.channel, 'pending', r.due_at)
      on conflict do nothing;
    else
      v_payload := public.appointment_payload(r.appointment_id);
      if r.channel = 'in_app' then
        v_title := case when r.offset_minutes >= 1440 then 'Appointment tomorrow'
                        else format('Appointment in %s', case when r.offset_minutes >= 60
                              then (r.offset_minutes / 60)::text || 'h' else r.offset_minutes::text || ' min' end) end;
        select d.profile_id into v_profile from public.doctors d where d.id = r.doctor_id;
        perform public.notify_user(v_profile, 'appointment_approaching', v_title,
          v_payload ->> 'patient_name', v_payload || jsonb_build_object('offset_minutes', r.offset_minutes),
          '/patients/' || r.patient_id || '?tab=appointments', r.patient_id, 'appointment', r.appointment_id);
        perform public.notify_permission('appointments.reminders', 'appointment_approaching', v_title,
          v_payload ->> 'patient_name', v_payload || jsonb_build_object('offset_minutes', r.offset_minutes),
          '/patients/' || r.patient_id || '?tab=appointments', r.patient_id, 'appointment', r.appointment_id, v_profile);
        insert into public.appointment_reminder_deliveries (appointment_id, rule_id, channel, status, due_at, processed_at)
        values (r.appointment_id, r.rule_id, r.channel, 'sent', r.due_at, now());
      else
        -- WhatsApp is never sent automatically: staff get a ready-to-send action.
        perform public.notify_permission('messages.prepare_whatsapp', 'whatsapp_reminder_ready', 'WhatsApp reminder ready',
          v_payload ->> 'patient_name', v_payload || jsonb_build_object('offset_minutes', r.offset_minutes),
          '/patients/' || r.patient_id || '?tab=appointments&message=' || r.appointment_id,
          r.patient_id, 'appointment', r.appointment_id);
        insert into public.appointment_reminder_deliveries (appointment_id, rule_id, channel, status, due_at, processed_at)
        values (r.appointment_id, r.rule_id, r.channel, 'prepared', r.due_at, now());
      end if;
    end if;
    v_n := v_n + 1;
  end loop;

  -- Clinical follow-ups due tomorrow → treating doctor (no clinical detail in text).
  for r in
    select a.id, a.patient_id, a.visit_type, d.profile_id
      from public.appointments a
      join public.doctors d on d.id = a.doctor_id and d.profile_id is not null
      join public.appointment_reminders ar on ar.appointment_id = a.id
     where a.status = 'scheduled'
       and ar.status = 'sent' and ar.sent_at > now() - interval '1 day'
       and a.visit_type in ('pregnancy', 'fertility', 'oi_followup')
       and not exists (select 1 from public.notifications n
                        where n.entity_id = a.id and n.type in ('pregnancy_followup_due', 'fertility_followup_due'))
  loop
    v_payload := public.appointment_payload(r.id);
    perform public.notify_user(r.profile_id,
      case when r.visit_type = 'pregnancy' then 'pregnancy_followup_due' else 'fertility_followup_due' end,
      'Follow-up due tomorrow', v_payload ->> 'patient_name', v_payload,
      '/patients/' || r.patient_id, r.patient_id, 'appointment', r.id);
  end loop;
  return v_n;
end;
$$;

-- The Node worker claims email reminders atomically (safe with several instances).
create or replace function public.claim_reminder_emails(p_limit integer default 20)
returns table (delivery_id uuid, appointment_id uuid, patient_id uuid, patient_email text, patient_language text, payload jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with c as (
    select x.id from public.appointment_reminder_deliveries x
     where x.status = 'pending' and x.channel = 'email'
     order by x.due_at
     limit p_limit
     for update skip locked
  ), u as (
    update public.appointment_reminder_deliveries x set status = 'processing'
      from c where x.id = c.id
    returning x.id, x.appointment_id
  )
  select u.id, u.appointment_id, a.patient_id, p.email, p.preferred_language, public.appointment_payload(u.appointment_id)
    from u join public.appointments a on a.id = u.appointment_id join public.patients p on p.id = a.patient_id;
end;
$$;

-- Outbox claim (status queued → sending), with retry/backoff handled by the worker.
create or replace function public.claim_email_outbox(p_limit integer default 20)
returns setof public.email_outbox
language sql
security definer
set search_path = public
as $$
  with c as (
    select id from public.email_outbox
     where status = 'queued' and next_attempt_at <= now()
     order by next_attempt_at
     limit p_limit
     for update skip locked
  )
  update public.email_outbox o set status = 'sending', attempts = o.attempts + 1
    from c where o.id = c.id
  returning o.*;
$$;

revoke execute on function public.queue_due_appointment_reminders() from public, anon, authenticated;
revoke execute on function public.claim_reminder_emails(integer) from public, anon, authenticated;
revoke execute on function public.claim_email_outbox(integer) from public, anon, authenticated;
revoke execute on function public.patient_doctor_profile(uuid) from public, anon, authenticated;
grant execute on function public.queue_due_appointment_reminders() to service_role;
grant execute on function public.claim_reminder_emails(integer) to service_role;
grant execute on function public.claim_email_outbox(integer) to service_role;

-- ---------------------------------------------------------------------
-- RLS for configuration tables
-- ---------------------------------------------------------------------
alter table public.notification_event_types enable row level security;
create policy notification_event_types_read on public.notification_event_types for select to authenticated using (true);
create policy notification_event_types_update on public.notification_event_types for update to authenticated
  using (public.has_permission('notifications.manage')) with check (public.has_permission('notifications.manage'));

alter table public.user_notification_preferences enable row level security;
create policy user_notification_preferences_own on public.user_notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.reminder_rules enable row level security;
create policy reminder_rules_read on public.reminder_rules for select to authenticated using (true);
create policy reminder_rules_update on public.reminder_rules for update to authenticated
  using (public.has_permission('notifications.manage')) with check (public.has_permission('notifications.manage'));

alter table public.message_templates enable row level security;
create policy message_templates_select on public.message_templates for select to authenticated
  using (public.has_permission('templates.view') or public.has_permission('messages.send'));
create policy message_templates_insert on public.message_templates for insert to authenticated
  with check (public.has_permission('templates.create') and not is_system);
create policy message_templates_update on public.message_templates for update to authenticated
  using (public.has_permission('templates.edit') or public.has_permission('templates.delete'))
  with check (public.has_permission('templates.edit') or public.has_permission('templates.delete'));

alter table public.message_template_versions enable row level security;
create policy message_template_versions_select on public.message_template_versions for select to authenticated
  using (public.has_permission('templates.view'));
revoke insert, update, delete, truncate on public.message_template_versions from anon, authenticated;
revoke delete, truncate on public.message_templates from anon, authenticated;

-- Touch + audit (email_accounts deliberately not audited row-by-row:
-- its ciphertext must never be copied into the audit log; the security
-- event log records configuration changes instead).
do $$
declare
  t text;
begin
  foreach t in array array['notification_event_types', 'message_templates', 'reminder_rules'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_touch_row()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit(%L)', t || '_audit', t, 'id');
  end loop;
end;
$$;
drop trigger if exists notification_event_types_audit on public.notification_event_types;
create trigger notification_event_types_audit after insert or update or delete on public.notification_event_types
  for each row execute function public.tg_audit('code');
create trigger email_accounts_touch before insert or update on public.email_accounts
  for each row execute function public.tg_touch_row();

-- Realtime for the communication history panel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'communication_logs') then
    alter publication supabase_realtime add table public.communication_logs;
  end if;
end;
$$;

-- pg_cron (when available) queues in-app / WhatsApp reminders every 5 min;
-- email delivery needs the app server (SMTP), which runs the same queue.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('appointment-reminder-rules', '*/5 * * * *', 'select public.queue_due_appointment_reminders()');
    exception when others then
      raise notice 'pg_cron schedule failed (%); the app server will run the reminder engine.', sqlerrm;
    end;
  end if;
end;
$$;
