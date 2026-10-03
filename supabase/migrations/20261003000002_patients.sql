-- =====================================================================
-- 0002 PATIENTS: the central entity + patient-level (master) history
-- =====================================================================
-- Patient-level tables hold exactly one row per patient (PK = patient_id)
-- and are created together with the patient. They are the single source
-- of truth for that information; visits/cycles store *snapshots* only.
-- =====================================================================

create sequence public.patient_code_seq;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  patient_code text not null unique
    default ('PAT-' || lpad(nextval('public.patient_code_seq')::text, 6, '0')),
  full_name text not null check (length(btrim(full_name)) >= 2),
  dob date check (dob > date '1900-01-01'),
  occupation text,
  phone text,
  phone_normalized text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored,
  address text,
  marriage_date date,
  blood_group text check (blood_group in ('A', 'B', 'AB', 'O')),
  rh text check (rh in ('+', '-')),
  payment_method text not null default 'cash' check (payment_method in ('cash', 'insurance')),
  -- Kept when switching to cash so history is not lost.
  insurance_company_id uuid references public.insurance_companies(id),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint patients_insurance_required
    check (payment_method = 'cash' or insurance_company_id is not null)
);
create index patients_full_name_trgm_idx on public.patients using gin (full_name extensions.gin_trgm_ops);
create index patients_phone_idx on public.patients(phone_normalized);
create index patients_dob_idx on public.patients(dob);
create index patients_created_at_idx on public.patients(created_at desc);
create index patients_insurance_idx on public.patients(insurance_company_id);

create or replace function public.tg_patients_guard()
returns trigger
language plpgsql
as $$
begin
  if new.patient_code is distinct from old.patient_code then
    raise exception 'Patient ID can never change.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger patients_guard before update on public.patients
  for each row execute function public.tg_patients_guard();

create table public.patient_husbands (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  full_name text,
  dob date check (dob > date '1900-01-01'),
  occupation text,
  phone text,
  blood_group text check (blood_group in ('A', 'B', 'AB', 'O')),
  rh text check (rh in ('+', '-')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.patient_medical_history (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  ht boolean,
  dm boolean,
  hypothyroidism boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.patient_surgical_history (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.patient_medications (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.patient_allergies (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  -- Free text. Empty/null = no known drug allergy (no warning shown).
  allergy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.patient_family_history (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  dm boolean,
  ht boolean,
  thrombosis boolean,
  cancer boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.patient_social_history (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

-- Menstrual baseline. `lmp` here is the patient's *current* LMP; cycles
-- and pregnancies keep their own contextual LMP.
create table public.patient_menstrual_history (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  menarche_age integer check (menarche_age between 6 and 25),
  regular_cycle boolean,
  period_duration integer check (period_duration between 1 and 20),      -- D (days of flow)
  cycle_frequency integer check (cycle_frequency between 10 and 120),    -- I (interval, days)
  amount text,
  dysmenorrhea text,
  pms text,
  lmp date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.patient_obstetric_history (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  gravida integer check (gravida between 0 and 30),
  para integer check (para between 0 and 30),
  full_term integer check (full_term between 0 and 30),
  premature integer check (premature between 0 and 30),
  abortions integer check (abortions between 0 and 30),
  living_male integer check (living_male between 0 and 30),
  living_female integer check (living_female between 0 and 30),
  normal_deliveries integer check (normal_deliveries between 0 and 30),
  c_sections integer check (c_sections between 0 and 30),
  miscarriages integer check (miscarriages between 0 and 30),
  miscarriages_first_trimester integer check (miscarriages_first_trimester between 0 and 30),
  miscarriages_second_trimester integer check (miscarriages_second_trimester between 0 and 30),
  last_delivery_date date,
  last_delivery_type text,
  dns boolean,
  anc boolean,
  anc_dm boolean,
  anc_ht boolean,
  anc_pph boolean,
  anc_abh boolean,
  anc_notes text,
  ppc text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

-- Create the one-row-per-patient history records with the patient so the
-- application can always UPDATE (with optimistic concurrency) instead of
-- racing on inserts.
create or replace function public.tg_patients_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.patient_husbands (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_medical_history (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_surgical_history (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_medications (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_allergies (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_family_history (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_social_history (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_menstrual_history (patient_id) values (new.id) on conflict do nothing;
  insert into public.patient_obstetric_history (patient_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger patients_after_insert after insert on public.patients
  for each row execute function public.tg_patients_after_insert();

-- Age is always derived from DOB in the clinic timezone.
create or replace function public.age_in_years(p_dob date, p_on date default null)
returns integer
language sql
stable
as $$
  select case when p_dob is null then null
    else extract(year from age(coalesce(p_on, (now() at time zone public.clinic_timezone())::date), p_dob))::integer
  end;
$$;
