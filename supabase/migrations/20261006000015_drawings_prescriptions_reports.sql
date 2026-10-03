-- =====================================================================
-- 0015 ULTRASOUND IMAGES & DRAWINGS, MEDICATIONS & PRESCRIPTIONS,
--      MEDICAL REPORTS, CENTRAL DOCUMENT ENGINE EXTENSIONS, TIMELINE
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ultrasound images (originals are never modified) + drawings (layers)
-- ---------------------------------------------------------------------
create table public.medical_images (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  visit_id uuid not null references public.visits(id),
  context text not null default 'gynecology' check (context in ('gynecology', 'fertility', 'pregnancy', 'other')),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  width integer not null check (width between 16 and 12000),
  height integer not null check (height between 16 and 12000),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  title text check (length(title) <= 200),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint medical_images_path check (storage_path like patient_id::text || '/images/%')
);
create index medical_images_visit_idx on public.medical_images(visit_id);
create index medical_images_patient_idx on public.medical_images(patient_id, created_at desc);

create table public.medical_drawings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  visit_id uuid not null references public.visits(id),
  image_id uuid references public.medical_images(id),
  template_key text check (template_key ~ '^[a-z0-9_]+$'),
  context text not null default 'gynecology' check (context in ('gynecology', 'fertility', 'pregnancy', 'other')),
  title text check (length(title) <= 200),
  notes text check (length(notes) <= 4000),
  -- Vector annotation layer: [{type, points|x,y,w,h, color, size, text, ...}]
  shapes jsonb not null default '[]'::jsonb check (jsonb_typeof(shapes) = 'array'),
  canvas_width integer not null check (canvas_width between 16 and 12000),
  canvas_height integer not null check (canvas_height between 16 and 12000),
  preview_path text,
  saved_versions integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint medical_drawings_background check (num_nonnulls(image_id, template_key) = 1),
  constraint medical_drawings_preview check (preview_path is null or preview_path like patient_id::text || '/drawings/%')
);
create index medical_drawings_visit_idx on public.medical_drawings(visit_id);
create index medical_drawings_patient_idx on public.medical_drawings(patient_id, created_at desc);

create table public.medical_drawing_versions (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.medical_drawings(id) on delete cascade,
  version_no integer not null,
  shapes jsonb not null,
  notes text,
  preview_path text,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (drawing_id, version_no)
);
create trigger medical_drawing_versions_immutable before update or delete on public.medical_drawing_versions
  for each row execute function public.tg_audit_logs_immutable();

create or replace function public.snapshot_drawing(p_drawing uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.medical_drawings;
begin
  select * into d from public.medical_drawings where id = p_drawing;
  if not found then return; end if;
  if exists (select 1 from public.medical_drawing_versions v where v.drawing_id = d.id and v.version_no = d.saved_versions
             and v.shapes = d.shapes and v.notes is not distinct from d.notes) then
    return;   -- nothing changed since the last version
  end if;
  insert into public.medical_drawing_versions (drawing_id, version_no, shapes, notes, preview_path, reason, created_by)
  values (d.id, d.saved_versions + 1, d.shapes, d.notes, d.preview_path, p_reason, coalesce(d.updated_by, d.created_by));
  update public.medical_drawings set saved_versions = d.saved_versions + 1 where id = d.id;
end;
$$;

-- History is kept: a completed visit's drawing can only change with a
-- reason and the previous state becomes a version; long-idle edits and
-- edits by another user also keep the previous state.
create or replace function public.tg_medical_drawings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed boolean;
begin
  if tg_op = 'UPDATE' then
    if new.patient_id <> old.patient_id or new.visit_id <> old.visit_id
       or new.image_id is distinct from old.image_id or new.template_key is distinct from old.template_key then
      raise exception 'A drawing cannot be moved to another record.' using errcode = '42501';
    end if;
    if pg_trigger_depth() > 1 then return new; end if;
    if (new.shapes, new.notes) is distinct from (old.shapes, old.notes) then
      select status = 'completed' into v_completed from public.visits where id = old.visit_id;
      if v_completed then
        if auth.uid() is not null and public.request_audit_reason() is null then
          raise exception 'A reason is required to correct a drawing of a completed visit.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
        end if;
        perform public.snapshot_drawing(old.id, public.request_audit_reason());
      elsif old.updated_at < now() - interval '15 minutes' or old.updated_by is distinct from auth.uid() then
        perform public.snapshot_drawing(old.id, null);
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger medical_drawings_guard before update on public.medical_drawings
  for each row execute function public.tg_medical_drawings_guard();

-- Completing a visit seals its drawings as a version.
create or replace function public.tg_visits_seal_drawings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    for d in select id from public.medical_drawings where visit_id = new.id and status = 'active' loop
      perform public.snapshot_drawing(d.id, 'visit completed');
    end loop;
  end if;
  return new;
end;
$$;
create trigger visits_seal_drawings after update of status on public.visits
  for each row execute function public.tg_visits_seal_drawings();

create or replace function public.visit_has_ultrasound(p_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ultrasound_annotations ua where ua.visit_id = p_visit and jsonb_array_length(ua.strokes) > 0)
      or exists (select 1 from public.medical_images mi where mi.visit_id = p_visit and mi.status = 'active')
      or exists (select 1 from public.medical_drawings md where md.visit_id = p_visit and md.status = 'active' and jsonb_array_length(md.shapes) > 0);
$$;

-- ---------------------------------------------------------------------
-- Medication catalog + prescriptions
-- ---------------------------------------------------------------------
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  name_en text not null check (length(btrim(name_en)) between 1 and 160),
  name_ar text,
  generic_name text,
  brand_name text,
  strength text,
  form text,
  route text,
  default_dose text,
  default_frequency text,
  default_duration text,
  default_instructions text,
  active boolean not null default true,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index medications_search_idx on public.medications
  using gin ((coalesce(name_en, '') || ' ' || coalesce(name_ar, '') || ' ' || coalesce(generic_name, '') || ' ' || coalesce(brand_name, '')) extensions.gin_trgm_ops);
create unique index medications_unique_idx on public.medications(lower(name_en), lower(coalesce(strength, '')), lower(coalesce(form, '')));

insert into public.medications (name_en, name_ar, generic_name, strength, form, route, default_dose, default_frequency, default_duration, default_instructions) values
  ('Folic Acid',          'حمض الفوليك',        'Folic acid',            '5 mg',     'Tablet',    'Oral',    '1 tablet', 'Once daily',  '3 months', 'After breakfast'),
  ('Folic Acid',          'حمض الفوليك',        'Folic acid',            '400 mcg',  'Tablet',    'Oral',    '1 tablet', 'Once daily',  '3 months', null),
  ('Progesterone',        'بروجesterون',        'Progesterone',          '200 mg',   'Capsule',   'Vaginal', '1 capsule','Twice daily', '14 days',  null),
  ('Dydrogesterone',      'دايدروجستيرون',      'Dydrogesterone',        '10 mg',    'Tablet',    'Oral',    '1 tablet', 'Twice daily', '14 days',  null),
  ('Letrozole',           'ليتروزول',           'Letrozole',             '2.5 mg',   'Tablet',    'Oral',    '1 tablet', 'Once daily',  '5 days',   'From day 3 of the cycle'),
  ('Clomiphene Citrate',  'كلوميفين',           'Clomiphene citrate',    '50 mg',    'Tablet',    'Oral',    '1 tablet', 'Once daily',  '5 days',   'From day 2 of the cycle'),
  ('Metformin',           'ميتفورمين',          'Metformin',             '500 mg',   'Tablet',    'Oral',    '1 tablet', 'Twice daily', '3 months', 'With meals'),
  ('Paracetamol',         'باراسيتامول',        'Paracetamol',           '500 mg',   'Tablet',    'Oral',    '1-2 tablets','Every 6 hours as needed', '5 days', 'Max 8 tablets/day'),
  ('Ferrous Sulfate',     'كبريتات الحديد',     'Ferrous sulfate',       '325 mg',   'Tablet',    'Oral',    '1 tablet', 'Once daily',  '3 months', 'Before meals'),
  ('Vitamin D3',          'فيتامين د3',         'Cholecalciferol',       '50000 IU', 'Capsule',   'Oral',    '1 capsule','Once weekly', '8 weeks',  null),
  ('Aspirin',             'أسبرين',             'Acetylsalicylic acid',  '100 mg',   'Tablet',    'Oral',    '1 tablet', 'Once daily',  null,       'After food'),
  ('Metronidazole',       'ميترونيدازول',       'Metronidazole',         '500 mg',   'Tablet',    'Oral',    '1 tablet', 'Twice daily', '7 days',   'Avoid alcohol'),
  ('Cabergoline',         'كابرجولين',          'Cabergoline',           '0.5 mg',   'Tablet',    'Oral',    '1 tablet', 'Twice weekly','4 weeks',  null)
on conflict do nothing;
update public.medications set name_ar = 'بروجستيرون' where name_en = 'Progesterone';

insert into public.dropdown_options (category, value, label_en, label_ar, sort_order) values
  ('rx_frequency', 'od',     'Once daily',           'مرة يومياً', 1),
  ('rx_frequency', 'bid',    'Twice daily',          'مرتين يومياً', 2),
  ('rx_frequency', 'tid',    'Three times daily',    'ثلاث مرات يومياً', 3),
  ('rx_frequency', 'qid',    'Four times daily',     'أربع مرات يومياً', 4),
  ('rx_frequency', 'hs',     'At bedtime',           'قبل النوم', 5),
  ('rx_frequency', 'weekly', 'Once weekly',          'مرة أسبوعياً', 6),
  ('rx_frequency', 'prn',    'As needed',            'عند الحاجة', 7),
  ('rx_route',     'oral',   'Oral',                 'عن طريق الفم', 1),
  ('rx_route',     'vaginal','Vaginal',              'مهبلي', 2),
  ('rx_route',     'im',     'Intramuscular',        'عضلي', 3),
  ('rx_route',     'sc',     'Subcutaneous',         'تحت الجلد', 4),
  ('rx_route',     'iv',     'Intravenous',          'وريدي', 5),
  ('rx_route',     'topical','Topical',              'موضعي', 6),
  ('rx_duration',  '5d',     '5 days',               '5 أيام', 1),
  ('rx_duration',  '7d',     '7 days',               '7 أيام', 2),
  ('rx_duration',  '14d',    '14 days',              '14 يوماً', 3),
  ('rx_duration',  '1m',     '1 month',              'شهر', 4),
  ('rx_duration',  '3m',     '3 months',             '3 أشهر', 5)
on conflict (category, value) do nothing;

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  prescription_number text not null unique,
  patient_id uuid not null references public.patients(id),
  visit_id uuid references public.visits(id),
  doctor_id uuid references public.doctors(id),
  status text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  notes text check (length(notes) <= 2000),
  issued_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index prescriptions_patient_idx on public.prescriptions(patient_id, created_at desc);
create index prescriptions_visit_idx on public.prescriptions(visit_id);

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions(id) on delete cascade,
  medication_id uuid references public.medications(id),
  medication_name text not null check (length(btrim(medication_name)) between 1 and 200),
  generic_name text,
  strength text,
  form text,
  dose text,
  route text,
  frequency text,
  duration text,
  quantity text,
  instructions text check (length(instructions) <= 500),
  notes text check (length(notes) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index prescription_items_rx_idx on public.prescription_items(prescription_id, sort_order);

create or replace function public.tg_prescriptions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.prescription_number := public.next_document_number('prescription');
    new.status := 'draft';
    return new;
  end if;
  if new.prescription_number <> old.prescription_number or new.patient_id <> old.patient_id then
    raise exception 'Prescription number and patient cannot change.' using errcode = '42501';
  end if;
  if old.status = 'cancelled' then
    raise exception 'This prescription was cancelled.' using errcode = '42501';
  end if;
  if old.status = 'issued' then
    if new.status = 'cancelled' then
      if auth.uid() is not null and not public.has_permission('prescriptions.edit') then
        raise exception 'Not allowed.' using errcode = '42501';
      end if;
      if public.request_audit_reason() is null and auth.uid() is not null then
        raise exception 'A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
      end if;
      new.cancelled_at := now();
      new.cancel_reason := public.request_audit_reason();
      return new;
    end if;
    if (to_jsonb(new) - array['updated_at', 'updated_by', 'version']) is distinct from (to_jsonb(old) - array['updated_at', 'updated_by', 'version']) then
      raise exception 'An issued prescription cannot be changed. Cancel it and write a new one.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
    end if;
  end if;
  if new.status = 'issued' and old.status = 'draft' then
    if not exists (select 1 from public.prescription_items where prescription_id = new.id) then
      raise exception 'Add at least one medication.' using errcode = 'P0001', hint = 'MISSING_FIELDS', detail = 'items';
    end if;
    new.issued_at := now();
  end if;
  return new;
end;
$$;
create trigger prescriptions_guard before insert or update on public.prescriptions
  for each row execute function public.tg_prescriptions_guard();

create or replace function public.tg_prescription_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.prescriptions where id = coalesce(new.prescription_id, old.prescription_id);
  if v_status <> 'draft' then
    raise exception 'An issued prescription cannot be changed. Cancel it and write a new one.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;
  if tg_op = 'INSERT' and new.medication_id is not null then
    update public.medications set use_count = use_count + 1 where id = new.medication_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger prescription_items_guard before insert or update or delete on public.prescription_items
  for each row execute function public.tg_prescription_items_guard();

-- Completing a visit issues its draft prescriptions (empty drafts are dropped).
create or replace function public.tg_visits_issue_prescriptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    delete from public.prescriptions p where p.visit_id = new.id and p.status = 'draft'
       and not exists (select 1 from public.prescription_items i where i.prescription_id = p.id);
    update public.prescriptions set status = 'issued' where visit_id = new.id and status = 'draft';
  end if;
  return new;
end;
$$;
create trigger visits_issue_prescriptions after update of status on public.visits
  for each row execute function public.tg_visits_issue_prescriptions();

-- Fast medication search (catalog only; never other patients' data).
create or replace function public.search_medications(p_query text, p_limit integer default 12)
returns setof public.medications
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select * from public.medications m
   where m.active
     and (p_query is null or p_query = ''
          or m.name_en ilike p_query || '%' or m.name_ar ilike p_query || '%'
          or m.generic_name ilike p_query || '%' or m.brand_name ilike p_query || '%'
          or (coalesce(m.name_en, '') || ' ' || coalesce(m.name_ar, '') || ' ' || coalesce(m.generic_name, '') || ' ' || coalesce(m.brand_name, '')) ilike '%' || p_query || '%')
   order by (m.name_en ilike p_query || '%' or m.name_ar ilike p_query || '%') desc, m.use_count desc, m.name_en, m.strength
   limit least(greatest(p_limit, 1), 30);
$$;

-- ---------------------------------------------------------------------
-- Medical reports (registered patients and standalone persons)
-- ---------------------------------------------------------------------
create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  code text unique check (code ~ '^[a-z][a-z0-9_]*$'),
  report_type text not null check (report_type in ('general', 'gynecology', 'fertility', 'pregnancy', 'opinion', 'referral',
                                                    'certificate', 'international', 'followup', 'custom')),
  name_en text not null,
  name_ar text not null,
  title_en text,
  title_ar text,
  recipient_en text,
  recipient_ar text,
  body_en text not null default '',
  body_ar text not null default '',
  active boolean not null default true,
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

insert into public.report_templates (code, report_type, name_en, name_ar, title_en, title_ar, recipient_en, recipient_ar, body_en, body_ar, is_system, sort_order) values
('general', 'general', 'General medical report', 'تقرير طبي عام', 'Medical Report', 'تقرير طبي', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$Mrs. {{patient_name}}, a {{age}} year old lady, was seen at our clinic on {{date}}.

Findings:


Recommendations:


Best regards,$t$,
$t$راجعتنا السيدة {{patient_name}}، العمر {{age}} سنة، بتاريخ {{date}}.

الموجودات:


التوصيات:


مع تمنياتنا لها دوام الصحة والعافية،$t$, true, 1),
('gynecology', 'gynecology', 'Gynecology report', 'تقرير نسائي', 'Gynecology Report', 'تقرير نسائي', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$Mrs. {{patient_name}}, a {{age}} year old lady with history of ...

On ultrasound examination she was found to have ...

Therefore, she was advised for ...

Best regards,$t$,
$t$راجعتنا السيدة {{patient_name}} وتبين في الفحص السريري وجود ...

وعليه تم نصحها بـ ...

مع تمنياتنا لها دوام الصحة والعافية،$t$, true, 2),
('fertility', 'fertility', 'Fertility report', 'تقرير خصوبة', 'Fertility Report', 'تقرير خصوبة', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$Mrs. {{patient_name}}, a {{age}} year old lady, is under our care for infertility.

Investigations:

Treatment plan:

Best regards,$t$,
$t$السيدة {{patient_name}}، العمر {{age}} سنة، تتابع لدينا لعلاج تأخر الإنجاب.

الفحوصات:

الخطة العلاجية:

مع تمنياتنا لها دوام الصحة والعافية،$t$, true, 3),
('pregnancy', 'pregnancy', 'Pregnancy report', 'تقرير حمل', 'Pregnancy Report', 'تقرير حمل', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$Mrs. {{patient_name}}, a {{age}} year old lady, is pregnant and followed up at our clinic.

Current status:

Recommendations:

Best regards,$t$,
$t$السيدة {{patient_name}}، العمر {{age}} سنة، حامل وتتابع لدى عيادتنا.

الوضع الحالي:

التوصيات:

مع تمنياتنا لها دوام الصحة والعافية،$t$, true, 4),
('opinion', 'opinion', 'Medical opinion', 'رأي طبي', 'Medical Opinion', 'رأي طبي', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$After reviewing the history and examination of Mrs. {{patient_name}}, our medical opinion is:

$t$,
$t$بعد مراجعة التاريخ المرضي والفحص للسيدة {{patient_name}}، فإن رأينا الطبي هو:

$t$, true, 5),
('referral', 'referral', 'Referral letter', 'رسالة تحويل', 'Referral Letter', 'رسالة تحويل', 'Dear colleague,', 'الزميل العزيز،',
$t$Kindly see Mrs. {{patient_name}}, a {{age}} year old lady, for further assessment and management of ...

Thank you,$t$,
$t$نرجو التكرم بمعاينة السيدة {{patient_name}}، العمر {{age}} سنة، لاستكمال التقييم والعلاج بخصوص ...

شاكرين تعاونكم،$t$, true, 6),
('certificate', 'certificate', 'Medical certificate', 'شهادة طبية', 'Medical Certificate', 'شهادة طبية', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$This is to certify that Mrs. {{patient_name}} was examined at our clinic on {{date}} and is advised to rest for ... days.$t$,
$t$نشهد بأن السيدة {{patient_name}} راجعت عيادتنا بتاريخ {{date}} وتم نصحها بالراحة لمدة ... أيام.$t$, true, 7),
('international', 'international', 'International patient report', 'تقرير مريضة دولية', 'Medical Report', 'تقرير طبي', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$Mrs. {{patient_name}}, a {{age}} year old lady (passport/reference {{reference}}), with history of ...

Findings:

Recommendations:

Best regards,$t$,
$t$السيدة {{patient_name}}، العمر {{age}} سنة (جواز/مرجع {{reference}})، مع تاريخ مرضي ...

الموجودات:

التوصيات:

مع التحية،$t$, true, 8),
('followup', 'followup', 'Follow-up report', 'تقرير متابعة', 'Follow-up Report', 'تقرير متابعة', 'To whom it may concern,', 'إلى من يهمه الأمر،',
$t$Mrs. {{patient_name}} is being followed up at our clinic.

Progress:

Plan:

Best regards,$t$,
$t$تتابع السيدة {{patient_name}} لدى عيادتنا.

التطور:

الخطة:

مع التحية،$t$, true, 9),
('custom', 'custom', 'Custom report', 'تقرير مخصص', 'Report', 'تقرير', null, null, '', '', true, 10)
on conflict (code) do nothing;

create table public.medical_reports (
  id uuid primary key default gen_random_uuid(),
  report_number text not null unique,
  patient_id uuid references public.patients(id),
  visit_id uuid references public.visits(id),
  template_id uuid references public.report_templates(id),
  report_type text not null default 'general',
  language text not null default 'en' check (language in ('ar', 'en', 'bilingual')),
  report_date date not null default ((now() at time zone 'Asia/Amman')::date),
  title text check (length(title) <= 200),
  recipient text check (length(recipient) <= 300),
  -- Person the report is about (snapshot for patients; entered for standalone reports).
  subject_name text not null check (length(btrim(subject_name)) between 2 and 200),
  subject_dob date,
  subject_age integer check (subject_age between 0 and 130),
  subject_country text check (length(subject_country) <= 100),
  subject_reference text check (length(subject_reference) <= 100),
  subject_patient_code text,
  doctor_id uuid references public.doctors(id),
  body_en text not null default '' check (length(body_en) <= 30000),
  body_ar text not null default '' check (length(body_ar) <= 30000),
  status text not null default 'draft' check (status in ('draft', 'final', 'void')),
  finalized_at timestamptz,
  finalized_by uuid,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index medical_reports_patient_idx on public.medical_reports(patient_id, report_date desc);
create index medical_reports_date_idx on public.medical_reports(report_date desc);
create index medical_reports_doctor_idx on public.medical_reports(doctor_id);

create table public.medical_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.medical_reports(id) on delete cascade,
  version_no integer not null,
  snapshot jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (report_id, version_no)
);
create trigger medical_report_versions_immutable before update or delete on public.medical_report_versions
  for each row execute function public.tg_audit_logs_immutable();

create or replace function public.tg_medical_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.report_number := public.next_document_number('report');
    if new.status <> 'draft' then
      new.finalized_at := now();
      new.finalized_by := auth.uid();
    end if;
    return new;
  end if;
  if new.report_number <> old.report_number then
    raise exception 'Report numbers never change.' using errcode = '42501';
  end if;
  if old.patient_id is not null and new.patient_id is distinct from old.patient_id then
    raise exception 'A report cannot be moved to another patient.' using errcode = '42501';
  end if;
  if old.status = 'void' then
    raise exception 'This report was voided.' using errcode = '42501';
  end if;
  if new.status = 'void' then
    if auth.uid() is not null and not public.has_permission('reports.delete') then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
    if auth.uid() is not null and public.request_audit_reason() is null then
      raise exception 'A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
    end if;
    new.void_reason := public.request_audit_reason();
  end if;
  -- A final report is a historical document: every change keeps the previous version.
  if old.status = 'final' and (to_jsonb(new) - array['updated_at', 'updated_by', 'version', 'status', 'void_reason', 'patient_id'])
                              is distinct from (to_jsonb(old) - array['updated_at', 'updated_by', 'version', 'status', 'void_reason', 'patient_id']) then
    if auth.uid() is not null and not public.has_permission('reports.edit') then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
    insert into public.medical_report_versions (report_id, version_no, snapshot, created_by)
    values (old.id, coalesce((select max(version_no) from public.medical_report_versions where report_id = old.id), 0) + 1,
            to_jsonb(old), auth.uid());
  end if;
  if new.status = 'final' and old.status = 'draft' then
    new.finalized_at := now();
    new.finalized_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger medical_reports_guard before insert or update on public.medical_reports
  for each row execute function public.tg_medical_reports_guard();

-- A finalized report for a patient is charged when a billable report /
-- certificate service is configured (once per report).
create or replace function public.tg_medical_reports_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid;
  v_trigger text := case when new.report_type = 'certificate' then 'medical_certificate' else 'medical_report' end;
  p public.patients;
begin
  if new.patient_id is null or new.status <> 'final' or (tg_op = 'UPDATE' and old.status = 'final') then
    return new;
  end if;
  if not exists (select 1 from public.services where auto_trigger = v_trigger and active and billable) then
    return new;
  end if;
  select id into v_invoice from public.invoices
   where patient_id = new.patient_id and status in ('open', 'partially_paid')
     and (visit_id = new.visit_id or (issued_at at time zone public.clinic_timezone())::date = (now() at time zone public.clinic_timezone())::date)
     and paid_patient + paid_insurance = 0
   order by (visit_id = new.visit_id) desc nulls last, issued_at desc
   limit 1;
  if v_invoice is null then
    select * into p from public.patients where id = new.patient_id;
    insert into public.invoices (patient_id, visit_id, doctor_id, payment_type, insurance_company_id)
    values (new.patient_id, new.visit_id, new.doctor_id,
            case when p.payment_method = 'insurance' then 'insurance' else 'cash' end,
            case when p.payment_method = 'insurance' then p.insurance_company_id end)
    returning id into v_invoice;
  end if;
  perform public.auto_charge(v_invoice, v_trigger);
  return new;
end;
$$;
create trigger medical_reports_billing after insert or update of status on public.medical_reports
  for each row execute function public.tg_medical_reports_billing();

-- ---------------------------------------------------------------------
-- Central document engine: new document types, standalone reports
-- ---------------------------------------------------------------------
alter table public.document_templates drop constraint if exists document_templates_document_type_check;
alter table public.document_templates add constraint document_templates_document_type_check check (document_type in (
  'patient_summary', 'medical_history', 'visit_summary', 'gynecology_visit', 'pregnancy_summary', 'pregnancy_followup',
  'fertility_summary', 'oi_chart', 'investigations', 'appointment_summary', 'timeline', 'ivf_consent',
  'prescription', 'medical_report', 'invoice', 'receipt', 'insurance_claim', 'drawing'));
insert into public.document_templates (document_type, name_en, name_ar, orientation, show_signature) values
  ('prescription',    'Prescription',             'وصفة طبية',        'portrait', true),
  ('medical_report',  'Medical Report',           'تقرير طبي',        'portrait', true),
  ('invoice',         'Invoice',                  'فاتورة',           'portrait', false),
  ('receipt',         'Payment Receipt',          'سند قبض',          'portrait', false),
  ('insurance_claim', 'Insurance Claim Summary',  'ملخص مطالبة تأمين', 'portrait', false),
  ('drawing',         'Ultrasound Drawing',       'رسم السونار',       'portrait', true)
on conflict (document_type) do nothing;

alter table public.generated_documents
  alter column patient_id drop not null,
  add column if not exists report_id uuid references public.medical_reports(id),
  add column if not exists prescription_id uuid references public.prescriptions(id),
  add column if not exists invoice_id uuid references public.invoices(id),
  add column if not exists payment_id uuid references public.payments(id),
  add column if not exists drawing_id uuid references public.medical_drawings(id);
alter table public.generated_documents drop constraint if exists generated_documents_path;
alter table public.generated_documents add constraint generated_documents_path check (
  (patient_id is not null and storage_path like patient_id::text || '/generated/%')
  or (patient_id is null and report_id is not null and storage_path like 'standalone/generated/%'));
alter table public.generated_documents drop constraint if exists generated_documents_source_entity_type_check;
alter table public.generated_documents add constraint generated_documents_source_entity_type_check check (source_entity_type in (
  'patient', 'visit', 'pregnancy_case', 'fertility_case', 'cycle', 'appointment', 'consent',
  'prescription', 'report', 'invoice', 'payment', 'drawing'));
create index if not exists generated_documents_report_idx on public.generated_documents(report_id);

alter table public.document_access_logs alter column patient_id drop not null;

-- One visibility rule for generated documents (policy + access log). It
-- works on the row's columns so INSERT ... RETURNING sees the new row.
create or replace function public.can_see_generated_row(
  p_patient uuid, p_report uuid, p_invoice uuid, p_payment uuid, p_generated_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_patient is null
              then p_report is not null and public.has_permission('reports.view')
              else public.can_access_patient(p_patient)
                   and (public.has_permission('documents.view') or p_generated_by = auth.uid())
         end
     and ((p_invoice is null and p_payment is null) or public.has_permission('accounting.view'))
     and (p_report is null or public.has_permission('reports.view') or p_generated_by = auth.uid());
$$;

create or replace function public.can_see_generated_document(p_doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.can_see_generated_row(g.patient_id, g.report_id, g.invoice_id, g.payment_id, g.generated_by)
                     from public.generated_documents g where g.id = p_doc), false);
$$;

drop policy if exists generated_documents_select on public.generated_documents;
create policy generated_documents_select on public.generated_documents for select to authenticated
  using (public.can_see_generated_row(patient_id, report_id, invoice_id, payment_id, generated_by));
drop policy if exists generated_documents_insert on public.generated_documents;
create policy generated_documents_insert on public.generated_documents for insert to authenticated
  with check (
    public.has_permission('documents.generate') and generated_by = auth.uid()
    and case when patient_id is null then report_id is not null and public.has_permission('reports.view')
             else public.can_access_patient(patient_id) end
  );
drop policy if exists generated_documents_update on public.generated_documents;
create policy generated_documents_update on public.generated_documents for update to authenticated
  using (public.has_permission('documents.delete') and public.can_see_generated_row(patient_id, report_id, invoice_id, payment_id, generated_by))
  with check (public.has_permission('documents.delete'));

create or replace function public.log_document_access(
  p_generated uuid, p_document uuid, p_action text, p_channel text default null,
  p_recipient text default null, p_result text default 'ok')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
  v_ok boolean := false;
begin
  if p_generated is not null then
    v_ok := public.can_see_generated_document(p_generated);
    select patient_id into v_patient from public.generated_documents where id = p_generated;
  else
    select patient_id into v_patient from public.documents d
     where d.id = p_document and public.can_access_patient(d.patient_id)
       and (public.has_permission('documents.view') or d.uploaded_by = auth.uid());
    v_ok := v_patient is not null;
  end if;
  if not v_ok then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  insert into public.document_access_logs (generated_document_id, document_id, patient_id, action, channel, recipient, result, actor_id)
  values (p_generated, case when p_generated is null then p_document end, v_patient, p_action,
          left(p_channel, 40), left(p_recipient, 320), coalesce(p_result, 'ok'), auth.uid());
end;
$$;

-- Storage: images, drawing previews and standalone report PDFs.
drop policy if exists patient_documents_insert on storage.objects;
create policy patient_documents_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (
      (public.can_access_patient(public.storage_path_patient(name)) and (
        (public.has_permission('documents.upload') and split_part(name, '/', 2) not in ('generated', 'images', 'drawings'))
        or (public.has_permission('documents.generate') and split_part(name, '/', 2) = 'generated'
            and name ~ '^[0-9a-f-]{36}/generated/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.pdf$')
        or (public.has_permission('drawings.create') and name ~ '^[0-9a-f-]{36}/images/[0-9a-f-]{36}\.(jpg|png|webp)$')
        or ((public.has_permission('drawings.create') or public.has_permission('drawings.edit'))
            and name ~ '^[0-9a-f-]{36}/drawings/[0-9a-f-]{36}\.png$')))
      or (public.has_permission('documents.generate') and public.has_permission('reports.view')
          and name ~ '^standalone/generated/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.pdf$')
    )
  );

drop policy if exists patient_documents_read on storage.objects;
create policy patient_documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-documents'
    and (
      (public.can_access_patient(public.storage_path_patient(name))
       and (public.has_permission('documents.view') or owner_id = auth.uid()::text
            or (split_part(name, '/', 2) in ('images', 'drawings') and public.has_permission('drawings.view'))))
      or (name like 'standalone/generated/%' and public.has_permission('reports.view'))
    )
  );

drop policy if exists patient_documents_cleanup on storage.objects;
create policy patient_documents_cleanup on storage.objects for delete to authenticated
  using (
    bucket_id = 'patient-documents'
    and owner_id = auth.uid()::text
    and not exists (select 1 from public.documents d where d.storage_path = name)
    and not exists (select 1 from public.generated_documents g where g.storage_path = name)
    and not exists (select 1 from public.medical_images i where i.storage_path = name)
    and not exists (select 1 from public.medical_drawings m where m.preview_path = name)
    and not exists (select 1 from public.medical_drawing_versions v where v.preview_path = name)
  );

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.medical_images enable row level security;
create policy medical_images_select on public.medical_images for select to authenticated
  using (public.has_permission('drawings.view') and public.can_access_patient(patient_id));
create policy medical_images_insert on public.medical_images for insert to authenticated
  with check (public.has_permission('drawings.create') and public.can_access_patient(patient_id)
              and public.visit_patient(visit_id) = patient_id);
create policy medical_images_update on public.medical_images for update to authenticated
  using ((public.has_permission('drawings.edit') or created_by = auth.uid()) and public.can_access_patient(patient_id))
  with check (public.has_permission('drawings.edit') or created_by = auth.uid());
revoke delete, truncate on public.medical_images from anon, authenticated;

alter table public.medical_drawings enable row level security;
create policy medical_drawings_select on public.medical_drawings for select to authenticated
  using (public.has_permission('drawings.view') and public.can_access_patient(patient_id));
create policy medical_drawings_insert on public.medical_drawings for insert to authenticated
  with check (public.has_permission('drawings.create') and public.can_access_patient(patient_id)
              and public.visit_patient(visit_id) = patient_id);
create policy medical_drawings_update on public.medical_drawings for update to authenticated
  using ((public.has_permission('drawings.edit') or (public.has_permission('drawings.create') and created_by = auth.uid()))
         and public.can_access_patient(patient_id))
  with check (public.has_permission('drawings.edit') or public.has_permission('drawings.create'));
revoke delete, truncate on public.medical_drawings from anon, authenticated;

alter table public.medical_drawing_versions enable row level security;
create policy medical_drawing_versions_select on public.medical_drawing_versions for select to authenticated
  using (exists (select 1 from public.medical_drawings d where d.id = drawing_id));
revoke insert, update, delete, truncate on public.medical_drawing_versions from anon, authenticated;

alter table public.medications enable row level security;
create policy medications_read on public.medications for select to authenticated
  using (public.has_permission('prescriptions.view') or public.has_permission('prescriptions.create') or public.has_permission('medications.manage'));
create policy medications_insert on public.medications for insert to authenticated with check (public.has_permission('medications.manage'));
create policy medications_update on public.medications for update to authenticated
  using (public.has_permission('medications.manage')) with check (public.has_permission('medications.manage'));

alter table public.prescriptions enable row level security;
create policy prescriptions_select on public.prescriptions for select to authenticated
  using (public.has_permission('prescriptions.view') and public.can_access_patient(patient_id));
create policy prescriptions_insert on public.prescriptions for insert to authenticated
  with check (public.has_permission('prescriptions.create') and public.can_access_patient(patient_id)
              and (visit_id is null or public.visit_patient(visit_id) = patient_id));
create policy prescriptions_update on public.prescriptions for update to authenticated
  using ((public.has_permission('prescriptions.edit') or (public.has_permission('prescriptions.create') and created_by = auth.uid()))
         and public.can_access_patient(patient_id))
  with check (public.has_permission('prescriptions.edit') or public.has_permission('prescriptions.create'));
create policy prescriptions_delete_empty_draft on public.prescriptions for delete to authenticated
  using (status = 'draft' and created_by = auth.uid()
         and not exists (select 1 from public.prescription_items i where i.prescription_id = id));

alter table public.prescription_items enable row level security;
create policy prescription_items_select on public.prescription_items for select to authenticated
  using (exists (select 1 from public.prescriptions p where p.id = prescription_id));
create policy prescription_items_write on public.prescription_items for all to authenticated
  using ((public.has_permission('prescriptions.create') or public.has_permission('prescriptions.edit'))
         and exists (select 1 from public.prescriptions p where p.id = prescription_id))
  with check ((public.has_permission('prescriptions.create') or public.has_permission('prescriptions.edit'))
              and exists (select 1 from public.prescriptions p where p.id = prescription_id));

alter table public.report_templates enable row level security;
create policy report_templates_read on public.report_templates for select to authenticated
  using (public.has_permission('reports.view') or public.has_permission('reports.create'));
create policy report_templates_insert on public.report_templates for insert to authenticated
  with check (public.has_permission('reports.edit') and not is_system);
create policy report_templates_update on public.report_templates for update to authenticated
  using (public.has_permission('reports.edit')) with check (public.has_permission('reports.edit'));

alter table public.medical_reports enable row level security;
create policy medical_reports_select on public.medical_reports for select to authenticated
  using (public.has_permission('reports.view') and (patient_id is null or public.can_access_patient(patient_id)));
create policy medical_reports_insert on public.medical_reports for insert to authenticated
  with check (public.has_permission('reports.create') and (patient_id is null or public.can_access_patient(patient_id)));
create policy medical_reports_update on public.medical_reports for update to authenticated
  using ((public.has_permission('reports.edit') or (public.has_permission('reports.create') and created_by = auth.uid() and status = 'draft')
          or public.has_permission('reports.delete'))
         and (patient_id is null or public.can_access_patient(patient_id)))
  with check (patient_id is null or public.can_access_patient(patient_id));
revoke delete, truncate on public.medical_reports from anon, authenticated;

alter table public.medical_report_versions enable row level security;
create policy medical_report_versions_select on public.medical_report_versions for select to authenticated
  using (exists (select 1 from public.medical_reports r where r.id = report_id));
revoke insert, update, delete, truncate on public.medical_report_versions from anon, authenticated;

do $$
declare
  t record;
begin
  for t in select * from (values ('medical_images'), ('medical_drawings'), ('medications'), ('prescriptions'),
                                 ('prescription_items'), ('report_templates'), ('medical_reports')) as x(tbl) loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_touch_row()', t.tbl || '_touch', t.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit(%L)', t.tbl || '_audit', t.tbl, 'id');
  end loop;
end;
$$;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['medical_drawings', 'prescriptions', 'prescription_items', 'medical_reports'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Patient timeline: drawings, prescriptions, reports, invoices, payments,
-- generated documents (each source keeps its own RLS: security_invoker).
-- ---------------------------------------------------------------------
create or replace view public.patient_timeline
with (security_invoker = true)
as
  select p.id as patient_id, 'patient_created'::text as event_type, p.created_at as occurred_at,
         'patient'::text as entity_type, p.id as entity_id, null::text as subtype, p.status, p.created_by as actor_id,
         null::integer as number
    from public.patients p
  union all
  select a.patient_id, 'appointment', a.scheduled_at, 'appointment', a.id, a.visit_type, a.status, a.created_by, null
    from public.appointments a
  union all
  select a.patient_id, 'checked_in', a.checked_in_at, 'appointment', a.id, a.visit_type, a.status, a.updated_by, null
    from public.appointments a where a.checked_in_at is not null
  union all
  select v.patient_id, 'visit', coalesce(v.completed_at, v.started_at), 'visit', v.id, v.visit_type, v.status, v.created_by, null
    from public.visits v
  union all
  select c.patient_id, 'fertility_case', c.opened_at, 'fertility_case', c.id, null, c.status, c.created_by, c.case_number
    from public.fertility_cases c
  union all
  select c.patient_id, 'pregnancy_case', c.opened_at, 'pregnancy_case', c.id, null, c.status, c.created_by, c.case_number
    from public.pregnancy_cases c
  union all
  select c.patient_id, 'oi_cycle_started', c.started_at, 'cycle', c.id, c.procedure, c.status, c.created_by, c.cycle_number
    from public.fertility_cycles c
  union all
  select c.patient_id, 'oi_cycle_completed', c.completed_at, 'cycle', c.id, c.procedure, c.status, c.updated_by, c.cycle_number
    from public.fertility_cycles c where c.completed_at is not null
  union all
  select d.patient_id, 'document', d.uploaded_at, 'document', d.id, d.category, d.status, d.uploaded_by, null
    from public.documents d
  union all
  select m.patient_id, 'drawing', m.created_at, 'drawing', m.id, m.context, m.status, m.created_by, null
    from public.medical_drawings m
  union all
  select r.patient_id, 'prescription', coalesce(r.issued_at, r.created_at), 'prescription', r.id, null, r.status, r.created_by, null
    from public.prescriptions r
  union all
  select r.patient_id, 'medical_report', coalesce(r.finalized_at, r.created_at), 'report', r.id, r.report_type, r.status, r.created_by, null
    from public.medical_reports r where r.patient_id is not null
  union all
  select i.patient_id, 'invoice', i.issued_at, 'invoice', i.id, null, i.status, i.created_by, null
    from public.invoices i
  union all
  select y.patient_id, 'payment', y.received_at, 'payment', y.id, y.method, y.kind, y.received_by, null
    from public.payments y
  union all
  select g.patient_id, 'generated_document', g.generated_at, 'generated_document', g.id, g.document_type, g.status, g.generated_by, g.version_no
    from public.generated_documents g where g.patient_id is not null;
