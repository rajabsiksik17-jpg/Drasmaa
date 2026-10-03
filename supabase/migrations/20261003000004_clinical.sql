-- =====================================================================
-- 0004 CLINICAL: visits, cases, O/I cycles, investigations, documents
-- =====================================================================
-- Data levels (never mixed):
--   patient-level  -> patient_* tables (0002)
--   visit-level    -> visits, visit_clinical, *_visits, pregnancy_followups
--   case/episode   -> fertility_cases, pregnancy_cases
--   cycle-level    -> fertility_cycles + fertility_cycle_* (structured, no JSON blobs)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cases / episodes
-- ---------------------------------------------------------------------
create table public.fertility_cases (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  case_number integer not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  infertility_type text check (infertility_type in ('primary', 'secondary')),
  duration_years numeric(4, 1) check (duration_years >= 0),
  notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (patient_id, case_number)
);
create index fertility_cases_patient_idx on public.fertility_cases(patient_id, status);

create table public.pregnancy_cases (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  case_number integer not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  outcome text,
  lmp date,                    -- pregnancy-specific LMP
  edd date,
  gravida integer check (gravida between 0 and 30),   -- imported snapshot, editable
  para integer check (para between 0 and 30),
  history text,                -- "History:" box on the paper card
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (patient_id, case_number)
);
-- A patient can have many pregnancies over time but only one active one.
create unique index pregnancy_cases_one_active_idx on public.pregnancy_cases(patient_id) where status = 'active';

-- ---------------------------------------------------------------------
-- Visits
-- ---------------------------------------------------------------------
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  doctor_id uuid references public.doctors(id),
  appointment_id uuid references public.appointments(id),
  department_id uuid references public.departments(id),
  visit_type text not null check (visit_type in ('pregnancy', 'fertility', 'gynecology')),
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed', 'cancelled')),
  form_code text not null,
  form_version integer not null,
  visit_date date not null default ((now() at time zone 'Asia/Amman')::date),
  patient_age_years integer,                 -- snapshot at the time of the visit
  fertility_case_id uuid references public.fertility_cases(id),
  pregnancy_case_id uuid references public.pregnancy_cases(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  foreign key (form_code, form_version) references public.form_definitions(code, version)
);
create index visits_patient_idx on public.visits(patient_id, started_at desc);
create index visits_doctor_idx on public.visits(doctor_id, started_at desc);
create index visits_appointment_idx on public.visits(appointment_id);
create index visits_date_idx on public.visits(visit_date);
create index visits_status_idx on public.visits(status);
create index visits_fertility_case_idx on public.visits(fertility_case_id);
create index visits_pregnancy_case_idx on public.visits(pregnancy_case_id);

alter table public.appointments
  add constraint appointments_source_visit_fk foreign key (source_visit_id) references public.visits(id);
create index appointments_source_visit_idx on public.appointments(source_visit_id);

-- Visit-level shared clinical data (History & Examination visit fields).
create table public.visit_clinical (
  visit_id uuid primary key references public.visits(id) on delete cascade,
  chief_complaint text,
  present_history text,
  examination text,
  lmp date,              -- visit-context LMP (imported from patient's current LMP)
  edd date,
  gravida integer check (gravida between 0 and 30),   -- visit snapshot (imported)
  para integer check (para between 0 and 30),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.gynecology_visits (
  visit_id uuid primary key references public.visits(id) on delete cascade,
  complaint text,
  irregular_cycle boolean,
  lap boolean,
  vaginitis boolean,
  symptom_notes text,
  ultrasound_template text not null default 'pelvis_v1',
  ultrasound_notes text,
  plan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

-- Drawing annotation layer, stored separately from the (unchanged)
-- template image as vector strokes.
create table public.ultrasound_annotations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  visit_id uuid not null references public.visits(id) on delete cascade,
  template_key text not null,
  strokes jsonb not null default '[]'::jsonb check (jsonb_typeof(strokes) = 'array'),
  width integer not null default 1000,
  height integer not null default 700,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (visit_id, template_key)
);
create index ultrasound_annotations_patient_idx on public.ultrasound_annotations(patient_id);

create table public.fertility_visits (
  visit_id uuid primary key references public.visits(id) on delete cascade,
  fertility_case_id uuid not null references public.fertility_cases(id),
  causes_of_infertility text,
  notes text,
  plan_primary text check (plan_primary in ('oi', 'iui', 'ivf')),
  plan_secondary text check (plan_secondary in ('oi', 'iui', 'ivf')),
  plan_notes text,
  ivf_consent_notes text,
  imported_from_visit_id uuid references public.visits(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index fertility_visits_case_idx on public.fertility_visits(fertility_case_id);

create table public.fertility_husband_data (
  visit_id uuid primary key references public.visits(id) on delete cascade,
  fertility_case_id uuid not null references public.fertility_cases(id),
  count text,
  motility text,
  morphology text,
  viscosity text,
  wbc text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.fertility_wife_data (
  visit_id uuid primary key references public.visits(id) on delete cascade,
  fertility_case_id uuid not null references public.fertility_cases(id),
  hormonal_profile text,
  hsg_result text check (hsg_result in ('normal', 'abnormal')),
  hsg_notes text,
  us text,
  us_notes text,
  afc integer check (afc between 0 and 200),
  uterus text,
  et text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.pregnancy_followups (
  id uuid primary key default gen_random_uuid(),
  pregnancy_case_id uuid not null references public.pregnancy_cases(id),
  visit_id uuid unique references public.visits(id) on delete set null,
  visit_no integer not null,
  followup_date date not null default ((now() at time zone 'Asia/Amman')::date),
  weight_kg numeric(5, 2) check (weight_kg between 20 and 300),
  bp_systolic integer check (bp_systolic between 40 and 300),
  bp_diastolic integer check (bp_diastolic between 20 and 200),
  complaint text,
  ultrasound text,
  lab text,
  plan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (pregnancy_case_id, visit_no)
);

-- ---------------------------------------------------------------------
-- Investigations: catalogue (0001) / record / result
-- ---------------------------------------------------------------------
create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  visit_id uuid references public.visits(id),
  type_code text not null references public.investigation_types(code),
  status text not null default 'requested' check (status in ('requested', 'performed', 'cancelled')),
  requested_on date not null default ((now() at time zone 'Asia/Amman')::date),
  performed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index investigations_patient_idx on public.investigations(patient_id, requested_on desc);
create index investigations_visit_idx on public.investigations(visit_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  visit_id uuid references public.visits(id),
  fertility_case_id uuid references public.fertility_cases(id),
  pregnancy_case_id uuid references public.pregnancy_cases(id),
  cycle_id uuid,                                   -- FK added below
  category text not null check (category in ('sfa', 'ivf_consent', 'investigation', 'ultrasound', 'medical', 'other')),
  title text,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_path text not null unique,
  status text not null default 'active' check (status in ('active', 'archived')),
  notes text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index documents_patient_idx on public.documents(patient_id, uploaded_at desc);
create index documents_visit_idx on public.documents(visit_id);
create index documents_fertility_case_idx on public.documents(fertility_case_id);
create index documents_pregnancy_case_idx on public.documents(pregnancy_case_id);
create index documents_cycle_idx on public.documents(cycle_id);
create index documents_category_idx on public.documents(patient_id, category);

create table public.investigation_results (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  investigation_id uuid references public.investigations(id),
  visit_id uuid references public.visits(id),
  type_code text not null references public.investigation_types(code),
  value_numeric numeric,
  value_text text,
  unit text,
  result_date date not null default ((now() at time zone 'Asia/Amman')::date),
  document_id uuid references public.documents(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index investigation_results_patient_idx on public.investigation_results(patient_id, type_code, result_date desc);
create index investigation_results_investigation_idx on public.investigation_results(investigation_id);
-- One result per type captured *inside* a given visit form.
create unique index investigation_results_visit_type_idx
  on public.investigation_results(visit_id, type_code) where visit_id is not null;

create table public.ivf_consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  fertility_case_id uuid not null references public.fertility_cases(id),
  visit_id uuid references public.visits(id),
  technique text check (technique in ('classic', 'icsi')),
  surplus_embryos text check (surplus_embryos in ('freeze', 'discard')),
  genetic_testing boolean not null default false,
  consent_date date,
  document_id uuid references public.documents(id),
  notes text,
  status text not null default 'draft' check (status in ('draft', 'signed', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index ivf_consents_case_idx on public.ivf_consents(fertility_case_id);

-- ---------------------------------------------------------------------
-- O/I cycles (structured)
-- ---------------------------------------------------------------------
create table public.fertility_cycles (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  fertility_case_id uuid not null references public.fertility_cases(id),
  doctor_id uuid references public.doctors(id),
  visit_id uuid references public.visits(id),
  cycle_number integer not null,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  form_code text not null default 'oi_chart',
  form_version integer not null default 1,
  -- Header box 1 (snapshots imported at creation, editable)
  wife_name text,
  wife_age integer,
  husband_name text,
  husband_age integer,
  lmp date,
  protocol text,
  -- Header box 2: single choice
  procedure text check (procedure in ('tsi', 'iui', 'icsi', 'frzn_et')),
  -- Header box 3: multiple choice
  addons text[] not null default '{}'::text[] check (addons <@ array['bc', 'aha', 'imsi', 'e_glue']::text[]),
  -- Header box 4: single choice
  sperm_retrieval text check (sperm_retrieval in ('tesa', 'tese', 'm_tese')),
  -- Header box 5
  inf_duration text,
  infertility_type text check (infertility_type in ('primary', 'secondary')),
  primary_note text,
  secondary_note text,
  -- Header box 6 + address strip
  address text,
  female_factor text,
  male_factor text,
  unexplained text,
  extra_note text,
  comments text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (patient_id, cycle_number),
  foreign key (form_code, form_version) references public.form_definitions(code, version)
);
create index fertility_cycles_case_idx on public.fertility_cycles(fertility_case_id);
create index fertility_cycles_patient_idx on public.fertility_cycles(patient_id, status);

alter table public.documents
  add constraint documents_cycle_fk foreign key (cycle_id) references public.fertility_cycles(id);

create table public.fertility_cycle_days (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.fertility_cycles(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 15),
  cycle_date date,
  is_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (cycle_id, day_number)
);

create table public.fertility_cycle_medications (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.fertility_cycles(id) on delete cascade,
  medication_code text not null check (medication_code in
    ('gnrh_agon', 'gnrh_antag', 'hmg', 'fsh', 'rec_fsh', 'cc_letroz', 'estrolem')),
  day_number integer not null check (day_number between 1 and 15),
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (cycle_id, medication_code, day_number)
);

-- Chart snapshot of hormone values. `source_result_id` points to the
-- master laboratory result it was imported from; editing the snapshot
-- never touches the source.
create table public.fertility_cycle_hormones (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.fertility_cycles(id) on delete cascade,
  hormone_code text not null check (hormone_code in ('amh', 'fsh', 'lh', 'e2', 'p4', 'prolactin', 'tsh')),
  value text,
  source_result_id uuid references public.investigation_results(id) on delete set null,
  source_date date,
  source_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (cycle_id, hormone_code)
);

create table public.fertility_cycle_follicles (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.fertility_cycles(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 15),
  side text not null check (side in ('R', 'L')),
  row_index integer not null check (row_index between 0 and 29),
  size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (cycle_id, day_number, side, row_index)
);

create table public.fertility_cycle_endometrium (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.fertility_cycles(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 15),
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  unique (cycle_id, day_number)
);

-- ---------------------------------------------------------------------
-- Parent lookups used by RLS and guards
-- ---------------------------------------------------------------------
create or replace function public.visit_patient(p_visit uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select patient_id from public.visits where id = p_visit; $$;

create or replace function public.cycle_patient(p_cycle uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select patient_id from public.fertility_cycles where id = p_cycle; $$;

create or replace function public.pregnancy_case_patient(p_case uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select patient_id from public.pregnancy_cases where id = p_case; $$;

create or replace function public.fertility_case_patient(p_case uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select patient_id from public.fertility_cases where id = p_case; $$;

-- ---------------------------------------------------------------------
-- Historical-record protection
-- ---------------------------------------------------------------------
create or replace function public.assert_correction_allowed(p_permission text, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission(p_permission) then
    raise exception '% can only be corrected by authorized users.', p_what using errcode = '42501';
  end if;
  if public.request_audit_reason() is null then
    raise exception 'A reason is required to correct %.', lower(p_what)
      using errcode = 'P0001', hint = 'REASON_REQUIRED';
  end if;
end;
$$;

create or replace function public.assert_visit_editable(p_visit uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_visit is null then return; end if;
  select status into v_status from public.visits where id = p_visit;
  if v_status = 'completed' then
    perform public.assert_correction_allowed('visits.edit_completed', 'A completed visit');
  elsif v_status = 'cancelled' then
    raise exception 'Cancelled visits cannot be edited.' using errcode = 'P0001', hint = 'VISIT_CANCELLED';
  end if;
end;
$$;

create or replace function public.assert_cycle_editable(p_cycle uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.fertility_cycles where id = p_cycle;
  if v_status in ('completed', 'cancelled') then
    perform public.assert_correction_allowed('oi.edit', 'A completed O/I cycle');
  end if;
end;
$$;

create or replace function public.tg_guard_visit_child()
returns trigger
language plpgsql
as $$
begin
  perform public.assert_visit_editable(old.visit_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.tg_guard_cycle_child()
returns trigger
language plpgsql
as $$
begin
  perform public.assert_cycle_editable(old.cycle_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.tg_guard_cycle_child_insert()
returns trigger
language plpgsql
as $$
begin
  perform public.assert_cycle_editable(new.cycle_id);
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['visit_clinical', 'gynecology_visits', 'fertility_visits',
                           'fertility_husband_data', 'fertility_wife_data', 'ultrasound_annotations'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.tg_guard_visit_child()', t || '_guard', t);
  end loop;
  foreach t in array array['fertility_cycle_days', 'fertility_cycle_medications', 'fertility_cycle_hormones',
                           'fertility_cycle_follicles', 'fertility_cycle_endometrium'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.tg_guard_cycle_child()', t || '_guard', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.tg_guard_cycle_child_insert()', t || '_guard_ins', t);
  end loop;
end;
$$;

create or replace function public.tg_visits_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  if old.status = 'completed' then
    if new.status <> 'completed' then
      raise exception 'A completed visit cannot be reopened.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
    end if;
    perform public.assert_correction_allowed('visits.edit_completed', 'A completed visit');
  elsif old.status = 'cancelled' then
    raise exception 'Cancelled visits cannot be edited.' using errcode = 'P0001', hint = 'VISIT_CANCELLED';
  end if;
  if new.patient_id is distinct from old.patient_id then
    raise exception 'A visit cannot be moved to another patient.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger visits_guard before update on public.visits
  for each row execute function public.tg_visits_guard();

create or replace function public.tg_cycles_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('completed', 'cancelled') then
    perform public.assert_correction_allowed('oi.edit', 'A completed O/I cycle');
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  end if;
  if new.patient_id is distinct from old.patient_id or new.fertility_case_id is distinct from old.fertility_case_id then
    raise exception 'A cycle cannot be moved to another patient or case.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger fertility_cycles_guard before update on public.fertility_cycles
  for each row execute function public.tg_cycles_guard();

-- Follow-up rows: free to edit while their visit is open (or the same
-- clinic day for rows added directly); afterwards corrections need a reason.
create or replace function public.tg_pregnancy_followups_guard()
returns trigger
language plpgsql
as $$
begin
  if old.visit_id is not null then
    perform public.assert_visit_editable(old.visit_id);
  elsif (old.created_at at time zone public.clinic_timezone())::date
        < (now() at time zone public.clinic_timezone())::date then
    perform public.assert_correction_allowed('pregnancy.edit', 'A previous follow-up');
  end if;
  if new.pregnancy_case_id is distinct from old.pregnancy_case_id or new.visit_no is distinct from old.visit_no then
    raise exception 'Follow-up numbering cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger pregnancy_followups_guard before update on public.pregnancy_followups
  for each row execute function public.tg_pregnancy_followups_guard();

-- Laboratory results are historical: same-day edits are free, later
-- corrections need a reason (and visit-bound results follow the visit).
create or replace function public.tg_investigation_results_guard()
returns trigger
language plpgsql
as $$
begin
  if old.visit_id is not null then
    perform public.assert_visit_editable(old.visit_id);
  elsif (old.created_at at time zone public.clinic_timezone())::date
        < (now() at time zone public.clinic_timezone())::date then
    perform public.assert_correction_allowed('investigations.edit', 'A historical result');
  end if;
  if new.patient_id is distinct from old.patient_id then
    raise exception 'A result cannot be moved to another patient.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger investigation_results_guard before update on public.investigation_results
  for each row execute function public.tg_investigation_results_guard();

-- ---------------------------------------------------------------------
-- Numbering, snapshots and initialization
-- ---------------------------------------------------------------------
create or replace function public.tg_number_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_column text := tg_argv[0];
begin
  -- Serialize numbering per patient.
  perform pg_advisory_xact_lock(hashtext(tg_table_name || new.patient_id::text));
  if tg_table_name = 'fertility_cases' then
    select coalesce(max(case_number), 0) + 1 into new.case_number from public.fertility_cases where patient_id = new.patient_id;
  elsif tg_table_name = 'pregnancy_cases' then
    select coalesce(max(case_number), 0) + 1 into new.case_number from public.pregnancy_cases where patient_id = new.patient_id;
  elsif tg_table_name = 'fertility_cycles' then
    select coalesce(max(cycle_number), 0) + 1 into new.cycle_number from public.fertility_cycles where patient_id = new.patient_id;
  end if;
  return new;
end;
$$;
create trigger fertility_cases_number before insert on public.fertility_cases
  for each row execute function public.tg_number_case('case_number');
create trigger pregnancy_cases_number before insert on public.pregnancy_cases
  for each row execute function public.tg_number_case('case_number');

create or replace function public.tg_pregnancy_cases_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obs public.patient_obstetric_history;
begin
  select * into v_obs from public.patient_obstetric_history where patient_id = new.patient_id;
  new.gravida := coalesce(new.gravida, v_obs.gravida);
  new.para := coalesce(new.para, v_obs.para);
  return new;
end;
$$;
create trigger pregnancy_cases_import before insert on public.pregnancy_cases
  for each row execute function public.tg_pregnancy_cases_before_insert();

create or replace function public.tg_pregnancy_followups_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('pregnancy_followups' || new.pregnancy_case_id::text));
  select coalesce(max(visit_no), 0) + 1 into new.visit_no
    from public.pregnancy_followups where pregnancy_case_id = new.pregnancy_case_id;
  return new;
end;
$$;
create trigger pregnancy_followups_number before insert on public.pregnancy_followups
  for each row execute function public.tg_pregnancy_followups_number();

create or replace function public.tg_visits_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dob date;
begin
  select dob into v_dob from public.patients where id = new.patient_id;
  new.visit_date := coalesce(new.visit_date, (now() at time zone public.clinic_timezone())::date);
  new.patient_age_years := public.age_in_years(v_dob, new.visit_date);
  new.doctor_id := coalesce(new.doctor_id, public.current_doctor_id());
  if new.form_version is null then
    select max(version) into new.form_version from public.form_definitions where code = new.form_code and active;
  end if;
  return new;
end;
$$;
create trigger visits_before_insert before insert on public.visits
  for each row execute function public.tg_visits_before_insert();

-- Keep the patient's *current* LMP up to date when a visit records a newer one.
create or replace function public.tg_visit_clinical_lmp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lmp is not null and (tg_op = 'INSERT' or new.lmp is distinct from old.lmp) then
    update public.patient_menstrual_history m
       set lmp = new.lmp
     where m.patient_id = public.visit_patient(new.visit_id)
       and (m.lmp is null or m.lmp < new.lmp);
  end if;
  return new;
end;
$$;
create trigger visit_clinical_lmp after insert or update of lmp on public.visit_clinical
  for each row execute function public.tg_visit_clinical_lmp();

create or replace function public.tg_cycles_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient public.patients;
  v_husband public.patient_husbands;
  v_lmp date;
begin
  select patient_id into new.patient_id from public.fertility_cases where id = new.fertility_case_id;
  if new.patient_id is null then
    raise exception 'Fertility case not found.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('fertility_cycles' || new.patient_id::text));
  select coalesce(max(cycle_number), 0) + 1 into new.cycle_number from public.fertility_cycles where patient_id = new.patient_id;

  select * into v_patient from public.patients where id = new.patient_id;
  select * into v_husband from public.patient_husbands where patient_id = new.patient_id;
  select lmp into v_lmp from public.patient_menstrual_history where patient_id = new.patient_id;

  new.wife_name := coalesce(new.wife_name, v_patient.full_name);
  new.wife_age := coalesce(new.wife_age, public.age_in_years(v_patient.dob));
  new.husband_name := coalesce(new.husband_name, v_husband.full_name);
  new.husband_age := coalesce(new.husband_age, public.age_in_years(v_husband.dob));
  new.lmp := coalesce(new.lmp, v_lmp);
  new.address := coalesce(new.address, v_patient.address);
  new.doctor_id := coalesce(new.doctor_id, public.current_doctor_id());
  return new;
end;
$$;
create trigger fertility_cycles_before_insert before insert on public.fertility_cycles
  for each row execute function public.tg_cycles_before_insert();

create or replace function public.latest_investigation_results(p_patient uuid, p_codes text[] default null)
returns setof public.investigation_results
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (r.type_code) r.*
    from public.investigation_results r
   where r.patient_id = p_patient
     and (p_codes is null or r.type_code = any (p_codes))
     and (r.value_numeric is not null or nullif(btrim(r.value_text), '') is not null)
   order by r.type_code, r.result_date desc, r.created_at desc;
$$;

create or replace function public.tg_cycles_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fertility_cycle_days (cycle_id, day_number)
  select new.id, g from generate_series(1, 15) g;

  -- Import latest hormone results as chart snapshots.
  insert into public.fertility_cycle_hormones (cycle_id, hormone_code, value, source_result_id, source_date, source_value)
  select new.id, h.hormone_code,
         coalesce(r.value_numeric::text, r.value_text),
         r.id, r.result_date, coalesce(r.value_numeric::text, r.value_text)
    from (values ('amh', 'amh'), ('fsh', 'fsh'), ('lh', 'lh'), ('e2', 'e2'),
                 ('p4', 'p4'), ('prolactin', 'prl'), ('tsh', 'tsh')) as h(hormone_code, inv_code)
    left join lateral (
      select * from public.investigation_results x
       where x.patient_id = new.patient_id and x.type_code = h.inv_code
         and (x.value_numeric is not null or nullif(btrim(x.value_text), '') is not null)
       order by x.result_date desc, x.created_at desc
       limit 1
    ) r on true;
  return new;
end;
$$;
create trigger fertility_cycles_after_insert after insert on public.fertility_cycles
  for each row execute function public.tg_cycles_after_insert();

-- Day 1 drives Day 2..15. Manually overridden dates are kept unless
-- p_keep_overrides = false. SECURITY INVOKER: RLS + guards apply.
create or replace function public.set_cycle_day1(p_cycle uuid, p_date date, p_keep_overrides boolean default true)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.fertility_cycle_days
     set cycle_date = p_date, is_override = false
   where cycle_id = p_cycle and day_number = 1;
  update public.fertility_cycle_days
     set cycle_date = case when p_date is null then null else p_date + (day_number - 1) end,
         is_override = false
   where cycle_id = p_cycle and day_number > 1
     and (not p_keep_overrides or not is_override);
end;
$$;

-- ---------------------------------------------------------------------
-- Visit workflow RPCs (SECURITY INVOKER: every write passes RLS)
-- ---------------------------------------------------------------------
create or replace function public.start_visit(
  p_patient uuid,
  p_visit_type text,
  p_appointment uuid default null,
  p_case uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_visit uuid;
  v_case uuid := p_case;
  v_dept uuid;
  v_appt public.appointments;
  v_mens public.patient_menstrual_history;
  v_obs public.patient_obstetric_history;
  v_prev uuid;
  v_form text;
begin
  if p_visit_type not in ('pregnancy', 'fertility', 'gynecology') then
    raise exception 'Unknown visit type.' using errcode = '22023';
  end if;

  if p_appointment is not null then
    select * into v_appt from public.appointments where id = p_appointment and patient_id = p_patient;
    if not found then
      raise exception 'Appointment not found for this patient.' using errcode = 'P0002';
    end if;
    -- Resume the open visit of this appointment instead of duplicating it.
    select id into v_visit from public.visits
     where appointment_id = p_appointment and visit_type = p_visit_type and status in ('draft', 'in_progress')
     limit 1;
    if v_visit is not null then
      return v_visit;
    end if;
    v_dept := v_appt.department_id;
  end if;
  if v_dept is null then
    select department_id into v_dept from public.doctors where id = public.current_doctor_id();
  end if;

  if p_visit_type = 'fertility' and v_case is null then
    select id into v_case from public.fertility_cases
     where patient_id = p_patient and status = 'active' order by opened_at desc limit 1;
    if v_case is null then
      insert into public.fertility_cases (patient_id) values (p_patient) returning id into v_case;
    end if;
  elsif p_visit_type = 'pregnancy' and v_case is null then
    select id into v_case from public.pregnancy_cases where patient_id = p_patient and status = 'active';
    if v_case is null then
      raise exception 'Create a pregnancy case first.' using errcode = 'P0001', hint = 'PREGNANCY_CASE_REQUIRED';
    end if;
  end if;

  v_form := case p_visit_type when 'pregnancy' then 'pregnancy' when 'fertility' then 'fertility' else 'gynecology' end;

  insert into public.visits (patient_id, appointment_id, department_id, visit_type, form_code,
                             fertility_case_id, pregnancy_case_id)
  values (p_patient, p_appointment, v_dept, p_visit_type, v_form,
          case when p_visit_type = 'fertility' then v_case end,
          case when p_visit_type = 'pregnancy' then v_case end)
  returning id into v_visit;

  select * into v_mens from public.patient_menstrual_history where patient_id = p_patient;
  select * into v_obs from public.patient_obstetric_history where patient_id = p_patient;
  insert into public.visit_clinical (visit_id, lmp, gravida, para, imported_at)
  values (v_visit, v_mens.lmp, v_obs.gravida, v_obs.para, now());

  if p_visit_type = 'gynecology' then
    insert into public.gynecology_visits (visit_id) values (v_visit);
  elsif p_visit_type = 'fertility' then
    -- Import the latest fertility visit of the same case as a starting point.
    select fv.visit_id into v_prev
      from public.fertility_visits fv join public.visits v on v.id = fv.visit_id
     where fv.fertility_case_id = v_case and v.status <> 'cancelled' and v.id <> v_visit
     order by v.started_at desc limit 1;

    insert into public.fertility_visits (visit_id, fertility_case_id, causes_of_infertility, imported_from_visit_id)
    select v_visit, v_case, (select causes_of_infertility from public.fertility_visits where visit_id = v_prev), v_prev;

    insert into public.fertility_husband_data (visit_id, fertility_case_id, count, motility, morphology, viscosity, wbc)
    select v_visit, v_case, h.count, h.motility, h.morphology, h.viscosity, h.wbc
      from (select 1) one left join public.fertility_husband_data h on h.visit_id = v_prev;

    insert into public.fertility_wife_data (visit_id, fertility_case_id, hormonal_profile, hsg_result, hsg_notes, uterus)
    select v_visit, v_case, w.hormonal_profile, w.hsg_result, w.hsg_notes, w.uterus
      from (select 1) one left join public.fertility_wife_data w on w.visit_id = v_prev;
  elsif p_visit_type = 'pregnancy' then
    insert into public.pregnancy_followups (pregnancy_case_id, visit_id) values (v_case, v_visit);
  end if;

  -- The patient is now with the doctor.
  if p_appointment is not null then
    if v_appt.status = 'scheduled' then
      update public.appointments set status = 'checked_in' where id = p_appointment;
      v_appt.status := 'checked_in';
    end if;
    if v_appt.status = 'checked_in' then
      update public.appointments set status = 'with_doctor' where id = p_appointment;
    end if;
  end if;

  return v_visit;
end;
$$;

-- Fields that must be filled before a visit can be completed. Drafts can
-- always be saved incomplete.
create or replace function public.visit_missing_fields(p_visit uuid)
returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v public.visits;
  v_missing text[] := '{}';
  f public.pregnancy_followups;
  fv public.fertility_visits;
  g public.gynecology_visits;
begin
  select * into v from public.visits where id = p_visit;
  if not found then
    raise exception 'Visit not found.' using errcode = 'P0002';
  end if;
  if v.visit_type = 'pregnancy' then
    select * into f from public.pregnancy_followups where visit_id = p_visit;
    if f.followup_date is null then v_missing := v_missing || 'followup_date'; end if;
    if f.bp_systolic is null or f.bp_diastolic is null then v_missing := v_missing || 'blood_pressure'; end if;
  elsif v.visit_type = 'fertility' then
    select * into fv from public.fertility_visits where visit_id = p_visit;
    if fv.plan_primary is null then v_missing := v_missing || 'plan_primary'; end if;
  elsif v.visit_type = 'gynecology' then
    select * into g from public.gynecology_visits where visit_id = p_visit;
    if nullif(btrim(coalesce(g.complaint, '')), '') is null then v_missing := v_missing || 'complaint'; end if;
  end if;
  return v_missing;
end;
$$;

create or replace function public.complete_visit(p_visit uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.visits;
  v_missing text[];
begin
  select * into v from public.visits where id = p_visit for update;
  if not found then
    raise exception 'Visit not found.' using errcode = 'P0002';
  end if;
  if v.status = 'completed' then
    return;
  end if;
  if not public.has_permission('visits.complete') then
    raise exception 'You are not allowed to complete visits.' using errcode = '42501';
  end if;
  v_missing := public.visit_missing_fields(p_visit);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Required fields are missing: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'MISSING_FIELDS', detail = array_to_string(v_missing, ',');
  end if;
  update public.visits
     set status = 'completed', completed_at = now(), completed_by = auth.uid()
   where id = p_visit;
  if v.appointment_id is not null then
    update public.appointments set status = 'completed'
     where id = v.appointment_id and status = 'with_doctor';
  end if;
end;
$$;
