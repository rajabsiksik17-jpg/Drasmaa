-- =====================================================================
-- 0001 CORE: extensions, configuration, roles, permissions, profiles
-- =====================================================================
-- Conventions
--   * Every mutable table carries: created_at, updated_at, created_by,
--     updated_by, version. `version` is bumped on every UPDATE by
--     tg_touch_row() and is used by the application for optimistic
--     concurrency (UPDATE ... WHERE version = <expected>).
--   * Statuses are text + CHECK constraints (easy to evolve, readable).
--   * Nothing clinical is ever hard-deleted; rows are archived/cancelled.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Generic row maintenance
-- ---------------------------------------------------------------------
create or replace function public.tg_touch_row()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    new.version := 1;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.version := old.version + 1;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Reference / configuration tables
-- ---------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name_en text not null,
  name_ar text not null,
  is_system boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.permissions (
  code text primary key,
  group_code text not null,
  description_en text not null,
  description_ar text not null,
  sort_order integer not null default 0
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (role_id, permission_code)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_ar text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  full_name_ar text,
  phone text,
  role_id uuid references public.roles(id),
  department_id uuid references public.departments(id),
  locale text not null default 'en' check (locale in ('en', 'ar')),
  preferences jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index profiles_role_idx on public.profiles(role_id);
create index profiles_department_idx on public.profiles(department_id);

create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  display_name_en text not null,
  display_name_ar text,
  department_id uuid references public.departments(id),
  specialty text,
  color text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index doctors_department_idx on public.doctors(department_id);

create table public.insurance_companies (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name_en text not null,
  name_ar text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

-- Configurable dropdowns (appointment types, O/I protocols, ...).
-- Options referenced by history are never deleted, only deactivated.
create table public.dropdown_options (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category ~ '^[a-z][a-z0-9_]*$'),
  value text not null,
  label_en text not null,
  label_ar text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (category, value)
);
create index dropdown_options_category_idx on public.dropdown_options(category, sort_order);

create table public.clinic_settings (
  id integer primary key default 1 check (id = 1),
  clinic_name_en text not null default 'Women''s Health & Fertility Clinic',
  clinic_name_ar text not null default 'عيادة صحة المرأة والخصوبة',
  phone text,
  email text,
  address_en text,
  address_ar text,
  logo_path text,
  timezone text not null default 'Asia/Amman',
  default_language text not null default 'en' check (default_language in ('en', 'ar')),
  appointment_slot_minutes integer not null default 15 check (appointment_slot_minutes between 5 and 240),
  working_hours_start time not null default '09:00',
  working_hours_end time not null default '18:00',
  doctor_access_scope text not null default 'all' check (doctor_access_scope in ('all', 'department', 'assigned')),
  receptionist_history_days integer not null default 30 check (receptionist_history_days between 1 and 3650),
  max_upload_mb integer not null default 20 check (max_upload_mb between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

-- Clinic timezone (default Asia/Amman) used for every "today" calculation.
create or replace function public.clinic_timezone()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select timezone from public.clinic_settings where id = 1), 'Asia/Amman');
$$;

-- Medical form versions: every clinical record stores which version of
-- the (paper-derived) form it was captured with.
create table public.form_definitions (
  code text not null,
  version integer not null,
  name_en text not null,
  name_ar text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (code, version)
);

-- Investigation catalogue (configuration). Records and results live in
-- separate tables (see 0004).
create table public.investigation_types (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name_en text not null,
  name_ar text not null,
  unit text,
  contexts text[] not null default '{}'::text[],
  active boolean not null default true,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so they can be used in RLS
-- without recursion; they only ever read the *current* user's grants).
-- ---------------------------------------------------------------------
create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.code
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.active and r.active;
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id and r.active
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid()
      and p.active
      and rp.permission_code = p_code
  );
$$;

create or replace function public.current_doctor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.id from public.doctors d where d.profile_id = auth.uid() and d.active limit 1;
$$;

-- Reason for a change, supplied by the application per request via the
-- `x-audit-reason` header (base64 UTF-8), which PostgREST exposes as the
-- `request.headers` GUC. `app.audit_reason` is accepted for SQL callers.
create or replace function public.request_audit_reason()
returns text
language plpgsql
stable
as $$
declare
  v_headers json;
  v_raw text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_raw := v_headers ->> 'x-audit-reason';
  if v_raw is null or v_raw = '' then
    return nullif(current_setting('app.audit_reason', true), '');
  end if;
  begin
    return convert_from(decode(v_raw, 'base64'), 'UTF8');
  exception when others then
    return v_raw;
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- Profiles are created automatically for every auth user.
-- Role is read from raw_APP_meta_data (only settable with the service
-- role key), never from user-editable user_meta_data.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_dept uuid;
  v_name text;
begin
  select id into v_role_id from public.roles where code = coalesce(new.raw_app_meta_data ->> 'role', '');
  v_dept := nullif(new.raw_app_meta_data ->> 'department_id', '')::uuid;
  v_name := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1));

  insert into public.profiles (id, email, full_name, full_name_ar, role_id, department_id, locale, created_by)
  values (
    new.id, new.email, v_name,
    nullif(new.raw_user_meta_data ->> 'full_name_ar', ''),
    v_role_id, v_dept,
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en'),
    new.id
  )
  on conflict (id) do nothing;

  if (new.raw_app_meta_data ->> 'role') = 'doctor' then
    insert into public.doctors (profile_id, display_name_en, display_name_ar, department_id, created_by)
    values (new.id, v_name, nullif(new.raw_user_meta_data ->> 'full_name_ar', ''), v_dept, new.id)
    on conflict (profile_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Users may update their own profile preferences, but never their own
-- role/active flag unless they hold users.manage.
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role_id is distinct from old.role_id
      or new.active is distinct from old.active
      or new.department_id is distinct from old.department_id)
     and auth.uid() is not null
     and not public.has_permission('users.manage') then
    raise exception 'You are not allowed to change role, department or status.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- Prevent an admin from locking everybody out of administration.
create or replace function public.tg_role_permissions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.roles r where r.id = old.role_id and r.code = 'admin')
     and old.permission_code in ('users.manage', 'roles.manage') then
    raise exception 'The administrator role must keep user and role management permissions.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger role_permissions_guard
  before delete on public.role_permissions
  for each row execute function public.tg_role_permissions_guard();

-- ---------------------------------------------------------------------
-- Baseline configuration (required in every environment, not demo data)
-- ---------------------------------------------------------------------
insert into public.clinic_settings (id) values (1) on conflict do nothing;

insert into public.permissions (code, group_code, description_en, description_ar, sort_order) values
  ('patients.view',            'patients',      'View patients (administrative data)',            'عرض المرضى (البيانات الإدارية)', 10),
  ('patients.view_all',        'patients',      'Access every patient regardless of assignment',  'الوصول لجميع المرضى', 11),
  ('patients.create',          'patients',      'Register new patients',                          'تسجيل مرضى جدد', 12),
  ('patients.edit',            'patients',      'Edit administrative patient data',               'تعديل البيانات الإدارية للمريض', 13),
  ('patients.archive',         'patients',      'Archive patient files',                          'أرشفة ملفات المرضى', 14),
  ('allergy.view',             'clinical',      'See drug-allergy warnings',                      'عرض تحذيرات حساسية الأدوية', 20),
  ('medical_history.view',     'clinical',      'View medical history',                           'عرض التاريخ المرضي', 21),
  ('medical_history.edit',     'clinical',      'Edit medical history',                           'تعديل التاريخ المرضي', 22),
  ('investigations.view',      'clinical',      'View investigations',                            'عرض الفحوصات', 23),
  ('investigations.edit',      'clinical',      'Record investigations and results',              'تسجيل الفحوصات والنتائج', 24),
  ('visits.view',              'visits',        'View all clinical visits',                       'عرض جميع الزيارات', 30),
  ('visits.view_recent',       'visits',        'View recent visit list (configurable window)',   'عرض الزيارات الأخيرة', 31),
  ('visits.create',            'visits',        'Start visits',                                   'بدء الزيارات', 32),
  ('visits.edit',              'visits',        'Edit draft visits',                              'تعديل مسودات الزيارات', 33),
  ('visits.complete',          'visits',        'Complete visits',                                'إنهاء الزيارات', 34),
  ('visits.edit_completed',    'visits',        'Correct completed visits (with reason)',         'تصحيح الزيارات المكتملة (مع السبب)', 35),
  ('fertility.view',           'fertility',     'View fertility records',                         'عرض سجلات الخصوبة', 40),
  ('fertility.edit',           'fertility',     'Edit fertility records',                         'تعديل سجلات الخصوبة', 41),
  ('oi.view',                  'fertility',     'View O/I charts',                                'عرض مخططات تحريض الإباضة', 42),
  ('oi.edit',                  'fertility',     'Edit O/I charts',                                'تعديل مخططات تحريض الإباضة', 43),
  ('pregnancy.view',           'pregnancy',     'View pregnancy records',                         'عرض سجلات الحمل', 50),
  ('pregnancy.edit',           'pregnancy',     'Edit pregnancy records',                         'تعديل سجلات الحمل', 51),
  ('gynecology.view',          'gynecology',    'View gynecology records',                        'عرض سجلات النسائية', 60),
  ('gynecology.edit',          'gynecology',    'Edit gynecology records',                        'تعديل سجلات النسائية', 61),
  ('documents.view',           'documents',     'View clinical documents',                        'عرض المستندات الطبية', 70),
  ('documents.upload',         'documents',     'Upload documents',                               'رفع المستندات', 71),
  ('documents.archive',        'documents',     'Archive documents',                              'أرشفة المستندات', 72),
  ('appointments.view',        'appointments',  'View appointments',                              'عرض المواعيد', 80),
  ('appointments.view_history','appointments',  'View appointments older than the recent window', 'عرض المواعيد القديمة', 81),
  ('appointments.create',      'appointments',  'Create appointments',                            'إنشاء المواعيد', 82),
  ('appointments.edit',        'appointments',  'Edit and reschedule appointments',               'تعديل وإعادة جدولة المواعيد', 83),
  ('appointments.cancel',      'appointments',  'Cancel / mark no-show',                          'إلغاء المواعيد / عدم الحضور', 84),
  ('appointments.checkin',     'appointments',  'Check patients in',                             'تسجيل وصول المرضى', 85),
  ('appointments.reminders',   'appointments',  'Receive appointment reminders',                  'استلام تذكيرات المواعيد', 86),
  ('settings.manage',          'admin',         'Manage clinic settings, departments, doctors, insurance and dropdowns', 'إدارة الإعدادات والأقسام والأطباء والتأمين والقوائم', 90),
  ('users.manage',             'admin',         'Manage users',                                   'إدارة المستخدمين', 91),
  ('roles.manage',             'admin',         'Manage roles and permissions',                   'إدارة الأدوار والصلاحيات', 92),
  ('audit.view',               'admin',         'View audit log',                                 'عرض سجل التدقيق', 93)
on conflict (code) do nothing;

insert into public.roles (code, name_en, name_ar, is_system, sort_order) values
  ('admin',        'Administrator', 'مدير النظام', true, 1),
  ('doctor',       'Doctor',        'طبيب',        true, 2),
  ('receptionist', 'Receptionist',  'موظف استقبال', true, 3)
on conflict (code) do nothing;

-- Admin: everything.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p where r.code = 'admin'
on conflict do nothing;

-- Doctor: full clinical workflow, no administration.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in (
  'patients.view', 'patients.create', 'patients.edit',
  'allergy.view', 'medical_history.view', 'medical_history.edit',
  'investigations.view', 'investigations.edit',
  'visits.view', 'visits.create', 'visits.edit', 'visits.complete', 'visits.edit_completed',
  'fertility.view', 'fertility.edit', 'oi.view', 'oi.edit',
  'pregnancy.view', 'pregnancy.edit', 'gynecology.view', 'gynecology.edit',
  'documents.view', 'documents.upload',
  'appointments.view', 'appointments.view_history', 'appointments.create', 'appointments.edit'
)
where r.code = 'doctor'
on conflict do nothing;

-- Receptionist: administrative workflow only; no clinical content.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in (
  'patients.view', 'patients.view_all', 'patients.create', 'patients.edit',
  'allergy.view', 'visits.view_recent', 'documents.upload',
  'appointments.view', 'appointments.create', 'appointments.edit',
  'appointments.cancel', 'appointments.checkin', 'appointments.reminders'
)
where r.code = 'receptionist'
on conflict do nothing;

insert into public.departments (code, name_en, name_ar, sort_order) values
  ('art',        'ART',        'أطفال الأنابيب والإخصاب المساعد', 1),
  ('gynecology', 'Gynecology', 'النسائية',                       2),
  ('aesthetics', 'Aesthetics', 'التجميل',                        3)
on conflict (code) do nothing;

insert into public.form_definitions (code, version, name_en, name_ar) values
  ('history_exam',   1, 'History and Examination',   'التاريخ المرضي والفحص'),
  ('pregnancy',      1, 'Pregnancy Follow-up',        'متابعة الحمل'),
  ('fertility',      1, 'Fertility',                  'الخصوبة'),
  ('gynecology',     1, 'Gynecology / Ultrasound',    'النسائية / الأمواج فوق الصوتية'),
  ('oi_chart',       1, 'Ovulation Induction Chart',  'مخطط تحريض الإباضة'),
  ('ivf_consent',    1, 'IVF Consent',                'موافقة الإخصاب خارج الجسم')
on conflict do nothing;

insert into public.investigation_types (code, name_en, name_ar, unit, contexts, sort_order) values
  ('tsh',          'TSH',            'TSH',               'mIU/L',  '{gynecology,fertility,pregnancy}', 1),
  ('prl',          'PRL',            'البرولاكتين',        'ng/mL',  '{gynecology,fertility}', 2),
  ('amh',          'AMH',            'AMH',               'ng/mL',  '{gynecology,fertility}', 3),
  ('cbc',          'CBC',            'CBC',               null,     '{gynecology,fertility,pregnancy}', 4),
  ('fe',           'Fe',             'الحديد',             null,     '{gynecology,fertility,pregnancy}', 5),
  ('b12',          'B12',            'B12',               'pg/mL',  '{gynecology,fertility,pregnancy}', 6),
  ('homa',         'HOMA',           'HOMA',              null,     '{gynecology,fertility,pregnancy}', 7),
  ('hba1c',        'HbA1c',          'HbA1c',             '%',      '{gynecology,fertility,pregnancy}', 8),
  ('crp',          'CRP',            'CRP',               'mg/L',   '{gynecology,fertility,pregnancy}', 9),
  ('fsh',          'FSH',            'FSH',               'mIU/mL', '{gynecology,fertility}', 10),
  ('lh',           'LH',             'LH',                'mIU/mL', '{gynecology,fertility}', 11),
  ('testosterone', 'Testosterone',   'التستوستيرون',       'ng/dL',  '{gynecology,fertility}', 12),
  ('ohp17',        '17-OHP',         '17-OHP',            'ng/mL',  '{gynecology,fertility}', 13),
  ('vitd',         'Vitamin D',      'فيتامين د',          'ng/mL',  '{gynecology,fertility,pregnancy}', 14),
  ('kft',          'KFT',            'وظائف الكلى',        null,     '{gynecology,fertility,pregnancy}', 15),
  ('lft',          'LFT',            'وظائف الكبد',        null,     '{gynecology,fertility,pregnancy}', 16),
  ('lipid',        'Lipid Profile',  'الدهون',             null,     '{gynecology,fertility,pregnancy}', 17),
  ('e2',           'E2',             'E2',                'pg/mL',  '{gynecology,fertility}', 18),
  ('p4',           'P4',             'P4',                'ng/mL',  '{gynecology,fertility}', 19),
  ('gtt',          'GTT',            'GTT',               null,     '{pregnancy}', 20),
  ('uric_acid',    'Uric Acid',      'حمض اليوريك',        'mg/dL',  '{pregnancy}', 21),
  ('ua_culture',   'UA + Culture',   'تحليل وزراعة البول', null,     '{pregnancy}', 22)
on conflict (code) do nothing;

insert into public.dropdown_options (category, value, label_en, label_ar, sort_order) values
  ('appointment_type', 'fertility',     'Fertility',              'خصوبة',              1),
  ('appointment_type', 'oi_followup',   'O/I Follow-up',          'متابعة تحريض الإباضة', 2),
  ('appointment_type', 'pregnancy',     'Pregnancy & Delivery',   'الحمل والولادة',      3),
  ('appointment_type', 'gynecology',    'Gynecology',             'نسائية',             4),
  ('appointment_type', 'consultation',  'Consultation',           'استشارة',            5),
  ('appointment_type', 'aesthetics',    'Aesthetics',             'تجميل',              6),
  ('oi_protocol',      'long_agonist',  'Long agonist',           'البروتوكول الطويل',   1),
  ('oi_protocol',      'short_agonist', 'Short agonist',          'البروتوكول القصير',   2),
  ('oi_protocol',      'antagonist',    'Antagonist',             'بروتوكول المضاد',     3),
  ('oi_protocol',      'mild',          'Mild stimulation',       'تحفيز خفيف',          4),
  ('oi_protocol',      'natural',       'Natural cycle',          'دورة طبيعية',         5),
  ('delivery_type',    'nvd',           'Normal (NVD)',           'ولادة طبيعية',        1),
  ('delivery_type',    'cs',            'C-section',              'قيصرية',             2),
  ('delivery_type',    'instrumental',  'Instrumental',           'ولادة بالأدوات',      3),
  ('uterus_finding',   'normal',        'Normal',                 'طبيعي',              1),
  ('uterus_finding',   'fibroid',       'Fibroid',                'ورم ليفي',           2),
  ('uterus_finding',   'septate',       'Septate',                'رحم بحاجز',          3),
  ('uterus_finding',   'adenomyosis',   'Adenomyosis',            'عضال غدي',           4)
on conflict (category, value) do nothing;
