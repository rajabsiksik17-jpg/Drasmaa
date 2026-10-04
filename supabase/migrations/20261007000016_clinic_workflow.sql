-- =====================================================================
-- 0016 CLINIC WORKFLOW (additive)
-- ---------------------------------------------------------------------
--  * Encounters ("clinic visits"): the patient's real presence in the
--    clinic, separate from appointments (planned time slots). Walk-ins
--    need no appointment; a checked-in appointment opens one automatically.
--    Queue: waiting_payment → waiting_doctor → with_doctor →
--    awaiting_checkout → checked_out (order depends on the payment workflow).
--  * Payment workflow setting (collect before the consultation or after).
--  * First-visit registration (file opening) fee as its own service line.
--  * Working hours per clinic / per doctor; outside-hours bookings need a
--    permission and are flagged.
--  * Doctor profile (contacts, license, photo, schedule, own prices).
--  * Role discount limits, discount author/time, payment idempotency,
--    enabled payment methods, "refunded" invoices.
--  * Drawings: archive metadata + restore, original file name.
-- All timestamps that matter are taken from the database clock.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, group_code, description_en, description_ar, sort_order) values
  ('encounters.create',          'appointments', 'Register walk-in visits and manage today''s queue', 'تسجيل زيارات الحضور وإدارة قائمة اليوم', 88),
  ('appointments.outside_hours', 'appointments', 'Book appointments outside working hours',          'الحجز خارج ساعات العمل', 89),
  ('billing.charge',             'accounting',   'Add services to a visit bill',                     'إضافة خدمات إلى فاتورة الزيارة', 129)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p where r.code = 'admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r
join public.permissions p on p.code in ('encounters.create', 'appointments.outside_hours', 'billing.charge', 'accounting.discount')
where r.code = 'receptionist'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r
join public.permissions p on p.code in ('encounters.create', 'billing.charge', 'accounting.discount')
where r.code = 'doctor'
on conflict do nothing;

-- Discount limits per role (null = unlimited).
alter table public.roles
  add column if not exists max_discount_percent numeric(5, 2) check (max_discount_percent between 0 and 100);
update public.roles set max_discount_percent = 10 where code = 'receptionist' and max_discount_percent is null;
update public.roles set max_discount_percent = 50 where code = 'doctor' and max_discount_percent is null;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
alter table public.clinic_settings
  add column if not exists collect_payment_before_consultation boolean not null default true,
  add column if not exists enforce_working_hours boolean not null default true,
  add column if not exists working_days smallint[] not null default '{0,1,2,3,4,5,6}'
    check (working_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  add column if not exists payment_methods text[] not null default '{cash,card,transfer,other}'
    check (payment_methods <@ '{cash,card,transfer,other}'::text[] and cardinality(payment_methods) >= 1);

-- ---------------------------------------------------------------------
-- Services: registration fee, requirements
-- ---------------------------------------------------------------------
alter table public.services drop constraint if exists services_category_check;
alter table public.services add constraint services_category_check check (category in (
  'registration', 'consultation', 'followup', 'ultrasound', 'investigation', 'report', 'certificate', 'procedure', 'treatment', 'package', 'other'));
alter table public.services drop constraint if exists services_auto_trigger_check;
alter table public.services add constraint services_auto_trigger_check
  check (auto_trigger in ('registration', 'ultrasound', 'medical_report', 'medical_certificate'));
alter table public.services
  add column if not exists requires_doctor boolean not null default false,
  add column if not exists requires_visit boolean not null default false;

insert into public.services (code, category, name_en, name_ar, price_cash, price_insurance, auto_trigger, insurance_eligible, sort_order)
values ('registration', 'registration', 'Patient file opening (registration)', 'فتح ملف (تسجيل مريضة)', 10, null, 'registration', false, 0)
on conflict (code) do nothing;
update public.services set requires_doctor = true where category in ('consultation', 'followup', 'ultrasound', 'procedure');

alter table public.invoice_lines drop constraint if exists invoice_lines_source_check;
alter table public.invoice_lines add constraint invoice_lines_source_check check (source in (
  'manual', 'appointment', 'registration', 'ultrasound', 'medical_report', 'medical_certificate', 'package'));

-- ---------------------------------------------------------------------
-- Doctor profile, schedule and own prices
-- ---------------------------------------------------------------------
alter table public.doctors
  add column if not exists phone text check (length(phone) <= 40),
  add column if not exists email text check (email is null or email ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$'),
  add column if not exists license_number text check (length(license_number) <= 80),
  add column if not exists photo_path text check (photo_path is null or photo_path like 'doctors/%');

create table public.doctor_working_hours (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday (extract(dow))
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  check (end_time > start_time),
  unique (doctor_id, weekday, start_time)
);
create index doctor_working_hours_doctor_idx on public.doctor_working_hours(doctor_id, weekday);

create table public.doctor_service_prices (
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  price_cash numeric(12, 3) not null check (price_cash >= 0),
  price_insurance numeric(12, 3) check (price_insurance >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (doctor_id, service_id)
);

-- Replaces a doctor's weekly schedule atomically (settings.manage via RLS).
create or replace function public.set_doctor_working_hours(p_doctor uuid, p_hours jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 42 then
    raise exception 'Invalid schedule.' using errcode = '22023';
  end if;
  delete from public.doctor_working_hours where doctor_id = p_doctor;
  insert into public.doctor_working_hours (doctor_id, weekday, start_time, end_time)
  select p_doctor, (h ->> 'weekday')::smallint, (h ->> 'start_time')::time, (h ->> 'end_time')::time
    from jsonb_array_elements(p_hours) h;
end;
$$;

-- Price of a service for an invoice: doctor price > insurer price > catalog.
create or replace function public.service_price_for(p_service uuid, p_payment_type text, p_insurance uuid, p_doctor uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_payment_type <> 'cash' and s.insurance_eligible then
      coalesce((select sip.price from public.service_insurance_prices sip
                 where sip.service_id = s.id and sip.insurance_company_id = p_insurance),
               (select dsp.price_insurance from public.doctor_service_prices dsp
                 where dsp.service_id = s.id and dsp.doctor_id = p_doctor),
               s.price_insurance,
               (select dsp.price_cash from public.doctor_service_prices dsp
                 where dsp.service_id = s.id and dsp.doctor_id = p_doctor),
               s.price_cash)
    else coalesce((select dsp.price_cash from public.doctor_service_prices dsp
                    where dsp.service_id = s.id and dsp.doctor_id = p_doctor), s.price_cash) end
  from public.services s where s.id = p_service;
$$;

-- ---------------------------------------------------------------------
-- Working hours
-- ---------------------------------------------------------------------
create or replace function public.within_working_hours(p_doctor uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := public.clinic_timezone();
  v_local timestamp := p_start at time zone v_tz;
  v_dow integer := extract(dow from v_local)::integer;
  v_from numeric := extract(epoch from v_local::time);
  v_to numeric := extract(epoch from v_local::time) + extract(epoch from (p_end - p_start));
  s public.clinic_settings;
begin
  if exists (select 1 from public.doctor_working_hours where doctor_id = p_doctor) then
    return exists (
      select 1 from public.doctor_working_hours w
       where w.doctor_id = p_doctor and w.weekday = v_dow
         and v_from >= extract(epoch from w.start_time) and v_to <= extract(epoch from w.end_time));
  end if;
  select * into s from public.clinic_settings where id = 1;
  if not found then return true; end if;
  return v_dow = any (s.working_days)
     and v_from >= extract(epoch from s.working_hours_start)
     and v_to <= extract(epoch from s.working_hours_end);
end;
$$;

alter table public.appointments
  add column if not exists outside_working_hours boolean not null default false;

create or replace function public.tg_appointments_before()
returns trigger
language plpgsql
as $$
declare
  v_allowed text[];
begin
  new.ends_at := new.scheduled_at + make_interval(mins => new.duration_minutes);

  if tg_op = 'INSERT' then
    if new.status not in ('scheduled', 'checked_in') then
      raise exception 'A new appointment must start as scheduled or checked in.' using errcode = '23514';
    end if;
    -- Working hours: outside bookings are explicit, permitted and flagged.
    if coalesce((select enforce_working_hours from public.clinic_settings where id = 1), true)
       and not public.within_working_hours(new.doctor_id, new.scheduled_at, new.ends_at) then
      if not new.outside_working_hours then
        raise exception 'This appointment is outside the configured working hours.'
          using errcode = 'P0001', hint = 'OUTSIDE_HOURS';
      end if;
      if auth.uid() is not null and not public.has_permission('appointments.outside_hours') then
        raise exception 'You are not allowed to book outside working hours.' using errcode = '42501';
      end if;
    else
      new.outside_working_hours := false;
    end if;
    if new.status = 'checked_in' then new.checked_in_at := coalesce(new.checked_in_at, now()); end if;
    return new;
  end if;

  if new.patient_id is distinct from old.patient_id
     or new.scheduled_at is distinct from old.scheduled_at
     or new.doctor_id is distinct from old.doctor_id
     or new.duration_minutes is distinct from old.duration_minutes then
    raise exception 'Use reschedule to change the patient, doctor, date or time of an appointment.'
      using errcode = 'P0001', hint = 'RESCHEDULE_REQUIRED';
  end if;
  new.outside_working_hours := old.outside_working_hours;

  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'scheduled'   then array['checked_in', 'cancelled', 'no_show', 'rescheduled']
      when 'checked_in'  then array['scheduled', 'with_doctor', 'cancelled', 'no_show', 'rescheduled']
      when 'with_doctor' then array['completed', 'checked_in']
      else array[]::text[]
    end;
    if not (new.status = any (v_allowed)) then
      raise exception 'Appointment cannot move from % to %.', old.status, new.status
        using errcode = 'P0001', hint = 'INVALID_TRANSITION';
    end if;
    case new.status
      when 'checked_in' then
        new.checked_in_at := coalesce(case when old.status = 'scheduled' then now() end, old.checked_in_at, now());
      when 'scheduled' then new.checked_in_at := null;
      when 'with_doctor' then new.with_doctor_at := now();
      when 'completed' then new.completed_at := now();
      when 'cancelled' then new.cancelled_at := now();
      else null;
    end case;
  end if;
  return new;
end;
$$;

-- Rescheduling keeps the outside-hours decision explicit.
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_doctor_id uuid default null,
  p_duration_minutes integer default null,
  p_notes text default null,
  p_outside_working_hours boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_appt public.appointments;
  v_new_id uuid;
begin
  select * into old_appt from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found.' using errcode = 'P0002';
  end if;
  if old_appt.status not in ('scheduled', 'checked_in') then
    raise exception 'Only scheduled or checked-in appointments can be rescheduled.'
      using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;

  update public.appointments set status = 'rescheduled' where id = p_appointment_id;

  insert into public.appointments (
    patient_id, doctor_id, department_id, visit_type, scheduled_at, duration_minutes,
    status, notes, payment_method, insurance_company_id, rescheduled_from_id, source_visit_id,
    service_id, no_charge, outside_working_hours)
  values (
    old_appt.patient_id, coalesce(p_doctor_id, old_appt.doctor_id), old_appt.department_id,
    old_appt.visit_type, p_scheduled_at, coalesce(p_duration_minutes, old_appt.duration_minutes),
    'scheduled', coalesce(p_notes, old_appt.notes), old_appt.payment_method,
    old_appt.insurance_company_id, old_appt.id, old_appt.source_visit_id,
    old_appt.service_id, old_appt.no_charge, coalesce(p_outside_working_hours, false))
  returning id into v_new_id;

  return v_new_id;
end;
$$;
drop function if exists public.reschedule_appointment(uuid, timestamptz, uuid, integer, text);

-- ---------------------------------------------------------------------
-- Invoices: discount author/limits, encounter link, refunded state
-- ---------------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('open', 'partially_paid', 'paid', 'no_charge', 'refunded', 'void'));
alter table public.invoices
  add column if not exists discount_by uuid,
  add column if not exists discount_at timestamptz;

alter table public.payments
  add column if not exists idempotency_key uuid unique;

-- ---------------------------------------------------------------------
-- Encounters
-- ---------------------------------------------------------------------
create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  doctor_id uuid references public.doctors(id),
  appointment_id uuid unique references public.appointments(id),
  service_id uuid references public.services(id),
  reason text check (length(reason) <= 500),
  source text not null default 'walk_in' check (source in ('walk_in', 'appointment', 'doctor')),
  status text not null check (status in (
    'waiting_payment', 'waiting_doctor', 'with_doctor', 'awaiting_checkout', 'checked_out', 'cancelled')),
  prepay boolean not null,                       -- payment workflow when the patient arrived
  queue_date date not null default ((now() at time zone public.clinic_timezone())::date),
  arrived_at timestamptz not null default now(), -- database clock, never the browser
  sent_to_doctor_at timestamptz,
  with_doctor_at timestamptz,
  finished_at timestamptz,
  checked_out_at timestamptz,
  cancelled_at timestamptz,
  status_reason text check (length(status_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index encounters_queue_idx on public.encounters(queue_date, status);
create index encounters_patient_idx on public.encounters(patient_id, arrived_at desc);
create index encounters_doctor_idx on public.encounters(doctor_id, queue_date);
-- One open clinic visit per patient per day (double clicks / two desks).
create unique index encounters_one_open_idx on public.encounters(patient_id, queue_date)
  where status not in ('checked_out', 'cancelled') and appointment_id is null;

alter table public.visits add column if not exists encounter_id uuid references public.encounters(id);
create index if not exists visits_encounter_idx on public.visits(encounter_id);
alter table public.invoices add column if not exists encounter_id uuid references public.encounters(id);
create unique index if not exists invoices_encounter_idx on public.invoices(encounter_id) where encounter_id is not null and status <> 'void';

-- Allowed status moves + server timestamps.
create or replace function public.tg_encounters_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[];
begin
  if tg_op = 'INSERT' then
    if new.status not in ('waiting_payment', 'waiting_doctor', 'with_doctor') then
      raise exception 'A clinic visit starts in the queue.' using errcode = '23514';
    end if;
    new.arrived_at := now();
    if new.status = 'waiting_doctor' then new.sent_to_doctor_at := now(); end if;
    if new.status = 'with_doctor' then new.sent_to_doctor_at := now(); new.with_doctor_at := now(); end if;
    return new;
  end if;
  if new.patient_id <> old.patient_id or new.arrived_at <> old.arrived_at or new.queue_date <> old.queue_date
     or new.prepay <> old.prepay or new.appointment_id is distinct from old.appointment_id then
    raise exception 'A clinic visit cannot be moved.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'waiting_payment'   then array['waiting_doctor', 'with_doctor', 'cancelled']
      when 'waiting_doctor'    then array['waiting_payment', 'with_doctor', 'cancelled']
      when 'with_doctor'       then array['waiting_doctor', 'awaiting_checkout']
      when 'awaiting_checkout' then array['with_doctor', 'checked_out']
      else array[]::text[] end;
    if not (new.status = any (v_allowed)) then
      raise exception 'Clinic visit cannot move from % to %.', old.status, new.status
        using errcode = 'P0001', hint = 'INVALID_TRANSITION';
    end if;
    case new.status
      when 'waiting_doctor' then new.sent_to_doctor_at := coalesce(old.sent_to_doctor_at, now());
      when 'with_doctor' then new.with_doctor_at := coalesce(old.with_doctor_at, now()); new.sent_to_doctor_at := coalesce(old.sent_to_doctor_at, now());
      when 'awaiting_checkout' then new.finished_at := now();
      when 'checked_out' then new.checked_out_at := now();
      when 'cancelled' then new.cancelled_at := now();
      else null;
    end case;
  end if;
  return new;
end;
$$;
create trigger encounters_guard before insert or update on public.encounters
  for each row execute function public.tg_encounters_guard();

-- First visit of a patient: no earlier registration charge and no earlier
-- clinic visit / clinical visit.
create or replace function public.is_first_visit(p_patient uuid, p_exclude_encounter uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
                      where i.patient_id = p_patient and i.status <> 'void' and l.source = 'registration')
     and not exists (select 1 from public.encounters e
                      where e.patient_id = p_patient and e.status <> 'cancelled'
                        and e.id is distinct from p_exclude_encounter)
     and not exists (select 1 from public.visits v where v.patient_id = p_patient and v.status <> 'cancelled');
$$;

-- Bill of a clinic visit: registration (first visit) + the visit service,
-- each as its own line with snapshot prices.
create or replace function public.encounter_invoice_internal(p_encounter uuid, p_payment_method text default null,
                                                             p_insurance uuid default null, p_no_charge boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.encounters;
  p public.patients;
  a public.appointments;
  v_invoice uuid;
  v_method text;
  v_reg uuid;
  v_service uuid;
begin
  select * into e from public.encounters where id = p_encounter;
  select id into v_invoice from public.invoices where encounter_id = e.id and status <> 'void';
  if v_invoice is not null then return v_invoice; end if;
  select * into p from public.patients where id = e.patient_id;
  v_reg := case when public.is_first_visit(e.patient_id, e.id) then
             (select id from public.services where auto_trigger = 'registration' and active and billable) end;

  if e.appointment_id is not null then
    select * into a from public.appointments where id = e.appointment_id;
    v_invoice := public.appointment_invoice_internal(e.appointment_id);
    perform set_config('app.internal_billing', 'on', true);
    update public.invoices set encounter_id = e.id, doctor_id = coalesce(doctor_id, e.doctor_id) where id = v_invoice;
    perform set_config('app.internal_billing', 'off', true);
  else
    v_method := coalesce(p_payment_method, p.payment_method, 'cash');
    insert into public.invoices (patient_id, encounter_id, doctor_id, payment_type, insurance_company_id)
    values (e.patient_id, e.id, e.doctor_id,
            case when v_method = 'insurance' then 'insurance' else 'cash' end,
            case when v_method = 'insurance' then coalesce(p_insurance, p.insurance_company_id) end)
    returning id into v_invoice;
    if not coalesce(p_no_charge, false) then
      v_service := e.service_id;
      if v_service is not null then
        perform public.invoice_add_service_internal(v_invoice, v_service, 1, 'appointment');
      end if;
    end if;
  end if;
  if v_reg is not null and not coalesce(p_no_charge, false) and not coalesce(a.no_charge, false)
     and not exists (select 1 from public.invoice_lines where invoice_id = v_invoice and source = 'registration') then
    perform public.invoice_add_service_internal(v_invoice, v_reg, 1, 'registration');
    update public.invoice_lines set sort_order = 0 where invoice_id = v_invoice and source = 'registration';
  end if;
  perform public.apply_default_coverage(v_invoice);
  return v_invoice;
end;
$$;

-- Patient part of the bill settled (or nothing to pay).
create or replace function public.encounter_bill_settled(p_encounter uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select i.balance_patient <= 0.0005 from public.invoices i
                    where i.encounter_id = p_encounter and i.status <> 'void'), true);
$$;

create or replace function public.notify_encounter_doctor(p_encounter uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.encounters;
  v_profile uuid;
begin
  select * into e from public.encounters where id = p_encounter;
  if e.source = 'appointment' and e.status = 'waiting_doctor' and not e.prepay then
    return;   -- the check-in already notified the doctor
  end if;
  select profile_id into v_profile from public.doctors where id = e.doctor_id and active;
  if v_profile is not null and v_profile is distinct from auth.uid() then
    perform public.notify_user(v_profile, 'patient_checked_in', 'New patient waiting', null,
                               jsonb_build_object('encounter_id', e.id), '/today', e.patient_id, 'encounter', e.id);
  end if;
end;
$$;

-- Register a clinic visit now (walk-in, or arrival of a booked patient).
create or replace function public.create_encounter(
  p_patient uuid,
  p_doctor uuid default null,
  p_service uuid default null,
  p_reason text default null,
  p_payment_method text default null,
  p_insurance uuid default null,
  p_no_charge boolean default false,
  p_appointment uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_prepay boolean;
  v_status text;
  s public.services;
  a public.appointments;
  v_source text := 'walk_in';
begin
  if auth.uid() is not null then
    if not (public.has_permission('encounters.create')
            or (p_appointment is not null and public.has_permission('appointments.checkin'))) then
      raise exception 'You are not allowed to register clinic visits.' using errcode = '42501';
    end if;
    if not public.can_access_patient(p_patient) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from public.patients where id = p_patient and status <> 'archived') then
    raise exception 'Patient not found.' using errcode = 'P0002';
  end if;
  if p_payment_method is not null and p_payment_method not in ('cash', 'insurance') then
    raise exception 'Unknown payment method.' using errcode = '22023';
  end if;
  if p_payment_method = 'insurance' and p_insurance is null
     and (select insurance_company_id from public.patients where id = p_patient) is null then
    raise exception 'Insurance company is required.' using errcode = 'P0001', hint = 'MISSING_FIELDS', detail = 'insurance_company_id';
  end if;

  -- Idempotent: an arrival is registered once (double clicks, two desks).
  if p_appointment is not null then
    select id into v_id from public.encounters where appointment_id = p_appointment;
  else
    select id into v_id from public.encounters
     where patient_id = p_patient and queue_date = (now() at time zone public.clinic_timezone())::date
       and status not in ('checked_out', 'cancelled')
     order by arrived_at desc limit 1;
  end if;
  if v_id is not null then
    return v_id;
  end if;

  if p_appointment is not null then
    select * into a from public.appointments where id = p_appointment and patient_id = p_patient;
    if not found then
      raise exception 'Appointment not found for this patient.' using errcode = 'P0002';
    end if;
    v_source := 'appointment';
  elsif public.current_doctor_id() is not null and public.has_permission('visits.create') then
    v_source := 'doctor';
  end if;

  if p_doctor is not null and not exists (select 1 from public.doctors where id = p_doctor and active) then
    raise exception 'Doctor not available.' using errcode = 'P0001', hint = 'MISSING_FIELDS', detail = 'doctor_id';
  end if;
  if p_service is not null then
    select * into s from public.services where id = p_service and active;
    if not found then
      raise exception 'Service not available.' using errcode = 'P0001', hint = 'MISSING_FIELDS', detail = 'service_id';
    end if;
    if s.requires_doctor and coalesce(p_doctor, a.doctor_id) is null then
      raise exception 'This service needs a doctor.' using errcode = 'P0001', hint = 'MISSING_FIELDS', detail = 'doctor_id';
    end if;
  end if;

  v_prepay := coalesce((select collect_payment_before_consultation from public.clinic_settings where id = 1), true);
  v_status := case when v_prepay then 'waiting_payment' else 'waiting_doctor' end;

  insert into public.encounters (patient_id, doctor_id, appointment_id, service_id, reason, source, status, prepay, created_by)
  values (p_patient, coalesce(p_doctor, a.doctor_id), p_appointment, coalesce(p_service, a.service_id),
          nullif(btrim(p_reason), ''), v_source, v_status, v_prepay, auth.uid())
  returning id into v_id;

  perform public.encounter_invoice_internal(v_id, p_payment_method, p_insurance, p_no_charge);

  -- Nothing for the patient to pay (no charge / full insurance): straight to the doctor.
  -- (The invoice trigger may already have moved it and notified the doctor.)
  if v_prepay and public.encounter_bill_settled(v_id) then
    update public.encounters set status = 'waiting_doctor' where id = v_id and status = 'waiting_payment';
    if found then perform public.notify_encounter_doctor(v_id); end if;
  elsif not v_prepay then
    perform public.notify_encounter_doctor(v_id);
  end if;
  return v_id;
end;
$$;

-- Manual queue moves (each with its own permission).
create or replace function public.set_encounter_status(p_encounter uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.encounters;
  inv public.invoices;
  v_reason text := nullif(btrim(coalesce(p_reason, public.request_audit_reason(), '')), '');
begin
  select * into e from public.encounters where id = p_encounter for update;
  if not found or not public.can_access_patient(e.patient_id) then
    raise exception 'Clinic visit not found.' using errcode = 'P0002';
  end if;
  if e.status = p_status then return; end if;
  select * into inv from public.invoices where encounter_id = e.id and status <> 'void';

  case p_status
    when 'waiting_doctor' then
      if e.status = 'with_doctor' then
        if not public.has_permission('visits.create') then raise exception 'Not allowed.' using errcode = '42501'; end if;
      else
        if not (public.has_permission('accounting.create') or public.has_permission('encounters.create')) then
          raise exception 'Not allowed.' using errcode = '42501';
        end if;
        -- Pre-payment workflow: an unpaid patient goes in only with a reason.
        if e.prepay and not public.encounter_bill_settled(e.id) and v_reason is null then
          raise exception 'The bill is not paid yet. A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
        end if;
      end if;
    when 'with_doctor' then
      if not public.has_permission('visits.create') then raise exception 'Not allowed.' using errcode = '42501'; end if;
    when 'awaiting_checkout' then
      if not (public.has_permission('visits.complete') or public.has_permission('billing.charge')) then
        raise exception 'Not allowed.' using errcode = '42501';
      end if;
    when 'checked_out' then
      if not public.has_permission('accounting.create') then raise exception 'Not allowed.' using errcode = '42501'; end if;
      if not public.encounter_bill_settled(e.id) and v_reason is null then
        raise exception 'The patient still has a balance. A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
      end if;
    when 'cancelled' then
      if not (public.has_permission('encounters.create') or public.has_permission('appointments.cancel')) then
        raise exception 'Not allowed.' using errcode = '42501';
      end if;
      if v_reason is null then
        raise exception 'A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
      end if;
      if exists (select 1 from public.visits where encounter_id = e.id and status <> 'cancelled') then
        raise exception 'A medical visit was already started.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
      end if;
      if inv.id is not null and inv.paid_patient + inv.paid_insurance > 0 then
        raise exception 'Refund the payments first.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
      end if;
      if inv.id is not null then
        perform set_config('app.internal_billing', 'on', true);
        update public.invoices set status = 'void', void_reason = v_reason where id = inv.id;
        perform set_config('app.internal_billing', 'off', true);
      end if;
    else
      raise exception 'Unknown status.' using errcode = '22023';
  end case;

  update public.encounters set status = p_status, status_reason = coalesce(v_reason, status_reason) where id = e.id;

  if p_status = 'waiting_doctor' and e.status in ('waiting_payment') then
    perform public.notify_encounter_doctor(e.id);
  end if;
  if p_status = 'checked_out' and e.appointment_id is not null then
    update public.appointments set status = 'completed' where id = e.appointment_id and status = 'with_doctor';
  end if;
end;
$$;

-- Payment settled → the patient moves on to the doctor queue.
create or replace function public.tg_invoices_encounter_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encounter_id is not null and new.balance_patient <= 0.0005 and new.status <> 'void' then
    update public.encounters set status = 'waiting_doctor'
     where id = new.encounter_id and status = 'waiting_payment';
    if found then perform public.notify_encounter_doctor(new.encounter_id); end if;
  end if;
  return new;
end;
$$;
create trigger invoices_encounter_sync after update of balance_patient, status on public.invoices
  for each row execute function public.tg_invoices_encounter_sync();

-- A checked-in appointment opens its clinic visit (queue + bill).
create or replace function public.tg_appointments_encounter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'checked_in' and (tg_op = 'INSERT' or old.status = 'scheduled')
     and not exists (select 1 from public.encounters where appointment_id = new.id) then
    perform public.create_encounter(new.patient_id, new.doctor_id, new.service_id, null,
                                    new.payment_method, new.insurance_company_id, new.no_charge, new.id);
  end if;
  return new;
end;
$$;
create trigger appointments_encounter after insert or update of status on public.appointments
  for each row execute function public.tg_appointments_encounter();

-- ---------------------------------------------------------------------
-- Billing functions (updated)
-- ---------------------------------------------------------------------
create or replace function public.invoice_add_service_internal(p_invoice uuid, p_service uuid, p_quantity integer default 1, p_source text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  s public.services;
  v_line uuid;
  item record;
begin
  select * into inv from public.invoices where id = p_invoice;
  select * into s from public.services where id = p_service;
  if inv.id is null or s.id is null then
    raise exception 'Invoice or service not found.' using errcode = 'P0002';
  end if;
  insert into public.invoice_lines (invoice_id, service_id, description_en, description_ar, quantity, unit_price, source, sort_order)
  values (p_invoice, s.id, s.name_en, s.name_ar, p_quantity,
          case when s.billable then coalesce(public.service_price_for(s.id, inv.payment_type, inv.insurance_company_id, inv.doctor_id), 0) else 0 end,
          case when s.category = 'package' then 'package' else p_source end,
          (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = p_invoice))
  returning id into v_line;
  if s.category = 'package' then
    for item in select pi.quantity, c.* from public.service_package_items pi join public.services c on c.id = pi.service_id where pi.package_id = s.id loop
      insert into public.invoice_lines (invoice_id, service_id, description_en, description_ar, quantity, unit_price, package_line_id, source, sort_order)
      values (p_invoice, item.id, item.name_en, item.name_ar, item.quantity * p_quantity, 0, v_line, 'package',
              (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = p_invoice));
    end loop;
  end if;
  return v_line;
end;
$$;

create or replace function public.add_invoice_service(p_invoice uuid, p_service uuid, p_quantity integer default 1)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  s public.services;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or not public.can_access_patient(inv.patient_id)
     or not (public.has_permission('accounting.create')
             or (public.has_permission('billing.charge') and inv.encounter_id is not null)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.services where id = p_service and active;
  if not found then
    raise exception 'Service not available.' using errcode = 'P0002';
  end if;
  if s.requires_visit and inv.encounter_id is null and inv.visit_id is null and inv.appointment_id is null then
    raise exception 'This service can only be charged to a visit.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;
  return public.invoice_add_service_internal(p_invoice, p_service, greatest(1, least(coalesce(p_quantity, 1), 100)), 'manual');
end;
$$;

create or replace function public.recalc_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  v_subtotal numeric;
  v_discount numeric;
  v_total numeric;
  v_ins numeric;
  v_paid_patient numeric;
  v_paid_ins numeric;
  v_refunds numeric;
  v_status text;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then return; end if;
  select coalesce(sum(line_total), 0) into v_subtotal from public.invoice_lines where invoice_id = p_invoice and package_line_id is null;
  v_discount := case inv.discount_type
                  when 'percent' then public.money_round(v_subtotal * inv.discount_value / 100)
                  when 'fixed' then least(inv.discount_value, v_subtotal)
                  else 0 end;
  v_total := v_subtotal - v_discount;
  v_ins := case when inv.payment_type = 'cash' then 0 else least(inv.insurance_amount, v_total) end;
  select coalesce(sum(case when kind = 'payment' then amount else -amount end) filter (where payer = 'patient'), 0),
         coalesce(sum(case when kind = 'payment' then amount else -amount end) filter (where payer = 'insurance'), 0),
         coalesce(sum(amount) filter (where kind = 'refund'), 0)
    into v_paid_patient, v_paid_ins, v_refunds
    from public.payments where invoice_id = p_invoice;
  v_status := case
    when inv.status = 'void' then 'void'
    when v_total = 0 and exists (select 1 from public.invoice_lines where invoice_id = p_invoice) then 'no_charge'
    when v_total > 0 and v_paid_patient >= v_total - v_ins and v_paid_ins >= v_ins then 'paid'
    when v_paid_patient > 0 or v_paid_ins > 0 then 'partially_paid'
    when v_refunds > 0 then 'refunded'
    else 'open' end;
  update public.invoices set
    subtotal = v_subtotal, discount_amount = v_discount, total = v_total,
    insurance_amount = v_ins, patient_amount = v_total - v_ins,
    paid_patient = v_paid_patient, paid_insurance = v_paid_ins,
    balance_patient = (v_total - v_ins) - v_paid_patient, balance_insurance = v_ins - v_paid_ins,
    refunded_total = v_refunds, status = v_status
  where id = p_invoice
    and (subtotal, discount_amount, total, insurance_amount, patient_amount, paid_patient, paid_insurance,
         balance_patient, balance_insurance, refunded_total, status)
        is distinct from
        (v_subtotal, v_discount, v_total, v_ins, v_total - v_ins, v_paid_patient, v_paid_ins,
         (v_total - v_ins) - v_paid_patient, v_ins - v_paid_ins, v_refunds, v_status);
end;
$$;

-- Insurance share defaults to the company coverage percentage. Recalculates
-- explicitly: it also runs inside trigger chains (check-in → clinic visit),
-- where the invoice's own recalc trigger does not fire.
create or replace function public.apply_default_coverage(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  v_pct numeric;
begin
  perform public.recalc_invoice(p_invoice);
  select * into inv from public.invoices where id = p_invoice;
  if inv.payment_type = 'cash' or inv.paid_insurance > 0 then return; end if;
  select default_coverage_percent into v_pct from public.insurance_companies where id = inv.insurance_company_id;
  update public.invoices set insurance_amount = public.money_round(inv.total * coalesce(v_pct, 100) / 100) where id = p_invoice;
  perform public.recalc_invoice(p_invoice);
end;
$$;

-- Automatic charges (ultrasound, report, ...) once per invoice. A paid bill
-- (pre-payment workflow) gets the new line and a balance to collect at
-- checkout: adding a service is not a correction of what was paid.
create or replace function public.auto_charge(p_invoice uuid, p_trigger text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service uuid;
begin
  select id into v_service from public.services where auto_trigger = p_trigger and active and billable;
  if v_service is null or p_invoice is null then return; end if;
  if exists (select 1 from public.invoice_lines where invoice_id = p_invoice and source = p_trigger) then return; end if;
  if exists (select 1 from public.invoices where id = p_invoice and status in ('void', 'refunded')) then return; end if;
  perform set_config('app.internal_billing', 'on', true);
  perform public.invoice_add_service_internal(p_invoice, v_service, 1, p_trigger);
  perform set_config('app.internal_billing', 'off', true);
  perform public.apply_default_coverage(p_invoice);
end;
$$;

create or replace function public.tg_invoice_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  v_row public.invoice_lines := coalesce(new, old);
begin
  select * into inv from public.invoices where id = v_row.invoice_id;
  if inv.status = 'void' then
    raise exception 'This invoice was voided.' using errcode = '42501';
  end if;
  if auth.uid() is not null and (inv.paid_patient + inv.paid_insurance) > 0
     and coalesce(current_setting('app.internal_billing', true), '') <> 'on' then
    if not public.has_permission('accounting.edit') then
      raise exception 'Paid invoices can only be corrected by authorized staff.' using errcode = '42501';
    end if;
    if public.request_audit_reason() is null then
      raise exception 'A reason is required to correct a paid invoice.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    new.line_total := case when new.package_line_id is null then public.money_round(new.unit_price * new.quantity) else 0 end;
    if new.package_line_id is not null then new.unit_price := 0; end if;
    return new;
  end if;
  return old;
end;
$$;

-- Discount percent of an invoice for limit checks.
create or replace function public.discount_percent(p_type text, p_value numeric, p_subtotal numeric)
returns numeric
language sql
immutable
as $$
  select case when p_type = 'percent' then coalesce(p_value, 0)
              when p_type = 'fixed' and coalesce(p_subtotal, 0) > 0 then least(100, p_value * 100 / p_subtotal)
              when p_type = 'fixed' and coalesce(p_value, 0) > 0 then 100
              else 0 end;
$$;

create or replace function public.tg_invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_payments boolean;
  v_limit numeric;
begin
  if tg_op = 'INSERT' then
    new.invoice_number := public.next_document_number('invoice');
    new.currency := coalesce((select currency from public.clinic_settings where id = 1), 'JOD');
    if new.discount_value > 0 then
      if auth.uid() is not null and not public.has_permission('accounting.discount') then
        raise exception 'You are not allowed to apply discounts.' using errcode = '42501';
      end if;
      new.discount_by := auth.uid();
      new.discount_at := now();
    end if;
    return new;
  end if;
  if pg_trigger_depth() > 1 then
    return new;   -- derived amounts written by recalc_invoice()
  end if;
  if new.invoice_number is distinct from old.invoice_number or new.patient_id is distinct from old.patient_id then
    raise exception 'Invoice number and patient cannot change.' using errcode = '42501';
  end if;
  if old.status = 'void' then
    raise exception 'This invoice was voided.' using errcode = '42501';
  end if;
  -- Internal workflow moves (e.g. cancelling an unpaid clinic visit).
  if current_setting('app.internal_billing', true) = 'on' then
    if new.status = 'void' then
      new.voided_at := now();
      new.voided_by := auth.uid();
    end if;
    return new;
  end if;
  if (new.discount_type, new.discount_value) is distinct from (old.discount_type, old.discount_value) then
    if auth.uid() is not null then
      if not public.has_permission('accounting.discount') then
        raise exception 'You are not allowed to apply discounts.' using errcode = '42501';
      end if;
      select max_discount_percent into v_limit from public.roles where code = public.current_role_code();
      if v_limit is not null and public.discount_percent(new.discount_type, new.discount_value, old.subtotal) > v_limit + 0.0001 then
        raise exception 'The discount exceeds your limit (% %%).', v_limit
          using errcode = 'P0001', hint = 'DISCOUNT_LIMIT', detail = v_limit::text;
      end if;
    end if;
    if coalesce(new.discount_value, 0) > 0 and length(btrim(coalesce(new.discount_reason, ''))) < 3 then
      raise exception 'A discount reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
    end if;
    new.discount_by := case when coalesce(new.discount_value, 0) > 0 then auth.uid() end;
    new.discount_at := case when coalesce(new.discount_value, 0) > 0 then now() end;
  end if;
  if auth.uid() is not null then
    v_has_payments := exists (select 1 from public.payments where invoice_id = old.id);
    if new.status = 'void' then
      if not public.has_permission('accounting.edit') then
        raise exception 'You are not allowed to void invoices.' using errcode = '42501';
      end if;
      if old.paid_patient + old.paid_insurance > 0 then
        raise exception 'Refund the payments before voiding the invoice.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
      end if;
      if public.request_audit_reason() is null then
        raise exception 'A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
      new.void_reason := public.request_audit_reason();
    elsif v_has_payments and (new.discount_type, new.discount_value, new.payment_type, new.insurance_amount, new.insurance_company_id)
          is distinct from (old.discount_type, old.discount_value, old.payment_type, old.insurance_amount, old.insurance_company_id) then
      if not public.has_permission('accounting.edit') then
        raise exception 'Paid invoices can only be corrected by authorized staff.' using errcode = '42501';
      end if;
      if public.request_audit_reason() is null then
        raise exception 'A reason is required to correct a paid invoice.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
      end if;
    end if;
    -- Derived amounts are never set by clients.
    new.subtotal := old.subtotal; new.discount_amount := old.discount_amount; new.total := old.total;
    new.patient_amount := old.patient_amount; new.paid_patient := old.paid_patient; new.paid_insurance := old.paid_insurance;
    new.balance_patient := old.balance_patient; new.balance_insurance := old.balance_insurance;
    new.refunded_total := old.refunded_total;
    new.encounter_id := old.encounter_id;
    if new.status <> 'void' then new.status := old.status; end if;
  end if;
  return new;
end;
$$;

-- Payments: enabled methods + previous rules.
create or replace function public.tg_payments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  orig public.payments;
  v_refunded numeric;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Payments are permanent. Use a refund to correct them.' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = new.invoice_id;
  if not found or inv.status = 'void' then
    raise exception 'Invoice not available.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;
  new.patient_id := inv.patient_id;
  new.receipt_number := public.next_document_number('receipt');
  new.received_at := now();
  new.register_date := (now() at time zone public.clinic_timezone())::date;
  if new.method = 'cash' and exists (select 1 from public.cash_registers r where r.register_date = new.register_date and r.status = 'closed') then
    raise exception 'The cash register for this day is closed.' using errcode = 'P0001', hint = 'REGISTER_CLOSED';
  end if;
  if new.kind = 'refund' then
    if auth.uid() is not null and not public.has_permission('accounting.refund') then
      raise exception 'You are not allowed to refund payments.' using errcode = '42501';
    end if;
    select * into orig from public.payments where id = new.refund_of_id;
    if not found or orig.kind <> 'payment' or orig.invoice_id <> new.invoice_id then
      raise exception 'Original payment not found.' using errcode = 'P0002';
    end if;
    select coalesce(sum(amount), 0) into v_refunded from public.payments where refund_of_id = orig.id;
    if new.amount > orig.amount - v_refunded then
      raise exception 'Refund exceeds the refundable amount.' using errcode = '23514';
    end if;
    new.payer := orig.payer;
  else
    if new.method <> 'insurance'
       and not (new.method = any (coalesce((select payment_methods from public.clinic_settings where id = 1), '{cash,card,transfer,other}'))) then
      raise exception 'This payment method is not enabled.' using errcode = 'P0001', hint = 'PAYMENT_METHOD_DISABLED';
    end if;
    if new.payer = 'patient' and new.amount > inv.balance_patient + 0.0005 then
      raise exception 'Payment exceeds the patient balance.' using errcode = '23514';
    end if;
    if new.payer = 'insurance' and new.amount > inv.balance_insurance + 0.0005 then
      raise exception 'Payment exceeds the insurance balance.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Several payments (cash + card ...) in ONE transaction, exactly once per
-- request key: a double click or a retried request returns the payments
-- already recorded instead of charging twice. Runs with the caller's rights.
create or replace function public.record_payments(p_invoice uuid, p_payments jsonb, p_key uuid)
returns setof uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_i integer := 0;
  v_id uuid;
begin
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 5 then
    raise exception 'Invalid payments.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where idempotency_key = md5(p_key::text || ':0')::uuid) then
    return query select id from public.payments
                  where idempotency_key in (select md5(p_key::text || ':' || g)::uuid from generate_series(0, 4) g)
                  order by received_at, receipt_number;
    return;
  end if;
  for v_item in select * from jsonb_array_elements(p_payments) loop
    insert into public.payments (invoice_id, payer, method, amount, reference, received_by, idempotency_key)
    values (p_invoice, v_item ->> 'payer', v_item ->> 'method', (v_item ->> 'amount')::numeric,
            nullif(btrim(v_item ->> 'reference'), ''), auth.uid(), md5(p_key::text || ':' || v_i)::uuid)
    returning id into v_id;
    v_i := v_i + 1;
    return next v_id;
  end loop;
end;
$$;

-- Completing a medical visit: the bill of its clinic visit gets the
-- automatic charges, and the clinic visit moves to checkout.
create or replace function public.tg_visits_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid;
  p public.patients;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.encounter_id is not null then
      v_invoice := public.encounter_invoice_internal(new.encounter_id);
      update public.invoices set visit_id = new.id where id = v_invoice and visit_id is null;
    elsif new.appointment_id is not null then
      v_invoice := public.appointment_invoice_internal(new.appointment_id);
      update public.invoices set visit_id = new.id where id = v_invoice and visit_id is null;
    else
      select id into v_invoice from public.invoices where visit_id = new.id and status <> 'void';
      if v_invoice is null then
        select * into p from public.patients where id = new.patient_id;
        insert into public.invoices (patient_id, visit_id, doctor_id, payment_type, insurance_company_id)
        values (new.patient_id, new.id, new.doctor_id,
                case when p.payment_method = 'insurance' then 'insurance' else 'cash' end,
                case when p.payment_method = 'insurance' then p.insurance_company_id end)
        returning id into v_invoice;
        perform public.invoice_add_service_internal(v_invoice, s.id, 1, 'appointment')
          from public.services s
         where s.active and s.appointment_type = new.visit_type;
      end if;
    end if;
    if public.visit_has_ultrasound(new.id) then
      perform public.auto_charge(v_invoice, 'ultrasound');
    end if;
    perform public.apply_default_coverage(v_invoice);
    if new.encounter_id is not null
       and not exists (select 1 from public.visits where encounter_id = new.encounter_id and id <> new.id and status in ('draft', 'in_progress')) then
      update public.encounters set status = 'awaiting_checkout' where id = new.encounter_id and status = 'with_doctor';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- start_visit: every medical visit belongs to a clinic visit.
-- ---------------------------------------------------------------------
drop function if exists public.start_visit(uuid, text, uuid, uuid);
create or replace function public.start_visit(
  p_patient uuid,
  p_visit_type text,
  p_appointment uuid default null,
  p_case uuid default null,
  p_encounter uuid default null
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
  v_enc public.encounters;
  v_doctor uuid := public.current_doctor_id();
  v_enc_id uuid;
begin
  if p_visit_type not in ('pregnancy', 'fertility', 'gynecology') then
    raise exception 'Unknown visit type.' using errcode = '22023';
  end if;

  if p_appointment is not null then
    select * into v_appt from public.appointments where id = p_appointment and patient_id = p_patient;
    if not found then
      raise exception 'Appointment not found for this patient.' using errcode = 'P0002';
    end if;
    select id into v_visit from public.visits
     where appointment_id = p_appointment and visit_type = p_visit_type and status in ('draft', 'in_progress')
     limit 1;
    if v_visit is not null then
      return v_visit;
    end if;
    v_dept := v_appt.department_id;
  end if;

  -- The clinic visit (encounter): given, from the appointment, today's open
  -- one, or a new one registered by the doctor.
  if p_encounter is not null then
    select * into v_enc from public.encounters where id = p_encounter and patient_id = p_patient;
    if not found then
      raise exception 'Clinic visit not found for this patient.' using errcode = 'P0002';
    end if;
    select id into v_visit from public.visits
     where encounter_id = p_encounter and visit_type = p_visit_type and status in ('draft', 'in_progress') limit 1;
    if v_visit is not null then
      return v_visit;
    end if;
  elsif p_appointment is not null then
    select * into v_enc from public.encounters where appointment_id = p_appointment;
  end if;
  if v_enc.id is null then
    select * into v_enc from public.encounters
     where patient_id = p_patient and queue_date = (now() at time zone public.clinic_timezone())::date
       and status not in ('checked_out', 'cancelled')
     order by arrived_at desc limit 1;
  end if;
  if v_enc.id is null then
    v_enc_id := public.create_encounter(p_patient, coalesce(v_appt.doctor_id, v_doctor), v_appt.service_id, null,
                                        v_appt.payment_method, v_appt.insurance_company_id, coalesce(v_appt.no_charge, false), p_appointment);
    select * into v_enc from public.encounters where id = v_enc_id;
  end if;

  if v_dept is null then
    select department_id into v_dept from public.doctors where id = coalesce(v_enc.doctor_id, v_doctor);
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

  insert into public.visits (patient_id, appointment_id, encounter_id, department_id, visit_type, form_code,
                             fertility_case_id, pregnancy_case_id)
  values (p_patient, coalesce(p_appointment, v_enc.appointment_id), v_enc.id, v_dept, p_visit_type, v_form,
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

  -- The patient is now with the doctor (clinic visit + appointment).
  perform public.encounter_mark_with_doctor(v_enc.id);
  if coalesce(p_appointment, v_enc.appointment_id) is not null then
    select * into v_appt from public.appointments where id = coalesce(p_appointment, v_enc.appointment_id);
    if v_appt.status = 'scheduled' then
      update public.appointments set status = 'checked_in' where id = v_appt.id;
      v_appt.status := 'checked_in';
    end if;
    if v_appt.status = 'checked_in' then
      update public.appointments set status = 'with_doctor' where id = v_appt.id;
    end if;
  end if;

  return v_visit;
end;
$$;

-- (Called from start_visit, which runs with the doctor's rights.)
create or replace function public.encounter_mark_with_doctor(p_encounter uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('visits.create') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.encounters
     set status = 'with_doctor', doctor_id = coalesce(doctor_id, public.current_doctor_id())
   where id = p_encounter and status in ('waiting_payment', 'waiting_doctor', 'awaiting_checkout');
end;
$$;

-- ---------------------------------------------------------------------
-- Atomic registration: patient + husband (+ optional clinic visit now
-- with its registration and service lines) in ONE transaction.
-- ---------------------------------------------------------------------
drop function if exists public.create_patient(jsonb, jsonb);
create or replace function public.create_patient(p_patient jsonb, p_husband jsonb default '{}'::jsonb, p_visit jsonb default null)
returns table (id uuid, patient_code text, encounter_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_enc uuid;
begin
  insert into public.patients (
    full_name, dob, occupation, phone, address, marriage_date, blood_group, rh,
    payment_method, insurance_company_id, assigned_doctor_id)
  values (
    p_patient ->> 'full_name',
    nullif(p_patient ->> 'dob', '')::date,
    nullif(p_patient ->> 'occupation', ''),
    nullif(p_patient ->> 'phone', ''),
    nullif(p_patient ->> 'address', ''),
    nullif(p_patient ->> 'marriage_date', '')::date,
    nullif(p_patient ->> 'blood_group', ''),
    nullif(p_patient ->> 'rh', ''),
    coalesce(nullif(p_patient ->> 'payment_method', ''), 'cash'),
    nullif(p_patient ->> 'insurance_company_id', '')::uuid,
    nullif(p_patient ->> 'assigned_doctor_id', '')::uuid)
  returning patients.id, patients.patient_code into v_id, v_code;

  if p_husband is not null and p_husband <> '{}'::jsonb then
    update public.patient_husbands h
       set full_name = nullif(p_husband ->> 'full_name', ''),
           dob = nullif(p_husband ->> 'dob', '')::date,
           occupation = nullif(p_husband ->> 'occupation', ''),
           blood_group = nullif(p_husband ->> 'blood_group', ''),
           rh = nullif(p_husband ->> 'rh', '')
     where h.patient_id = v_id;
  end if;

  if p_visit is not null and p_visit <> '{}'::jsonb then
    v_enc := public.create_encounter(
      v_id,
      coalesce(nullif(p_visit ->> 'doctor_id', '')::uuid, (select assigned_doctor_id from public.patients where patients.id = v_id)),
      nullif(p_visit ->> 'service_id', '')::uuid,
      nullif(p_visit ->> 'reason', ''),
      null, null,
      coalesce((p_visit ->> 'no_charge')::boolean, false),
      null);
  end if;

  return query select v_id, v_code, v_enc;
end;
$$;

-- ---------------------------------------------------------------------
-- Drawings: archive metadata, restore, original file name
-- ---------------------------------------------------------------------
alter table public.medical_images
  add column if not exists original_filename text check (length(original_filename) <= 255),
  add column if not exists uploaded_by uuid default auth.uid();
alter table public.medical_drawings
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists archive_reason text check (length(archive_reason) <= 300);

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
    if new.status is distinct from old.status then
      if auth.uid() is not null and not public.has_permission('drawings.edit')
         and not (new.status = 'archived' and old.created_by = auth.uid()) then
        raise exception 'You are not allowed to delete or restore drawings.' using errcode = '42501';
      end if;
      if new.status = 'archived' then
        if auth.uid() is not null and public.request_audit_reason() is null then
          raise exception 'A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
        end if;
        new.archived_at := now();
        new.archived_by := auth.uid();
        new.archive_reason := public.request_audit_reason();
      else
        new.archived_at := null;
        new.archived_by := null;
        new.archive_reason := null;
      end if;
    end if;
    if (new.shapes, new.notes) is distinct from (old.shapes, old.notes) then
      if old.status = 'archived' then
        raise exception 'Restore the drawing before editing it.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
      end if;
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

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.encounters enable row level security;
create policy encounters_select on public.encounters for select to authenticated
  using (public.can_access_patient(patient_id)
         and (public.has_permission('appointments.view') or public.has_permission('visits.view')
              or public.has_permission('visits.view_recent') or public.has_permission('accounting.view')
              or public.has_permission('encounters.create')));
-- Writes only through create_encounter / set_encounter_status / start_visit.
revoke insert, update, delete, truncate on public.encounters from anon, authenticated;

-- Doctors see / complete the bill of their clinic visits (post-payment workflow).
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using (public.can_access_patient(patient_id)
         and (public.has_permission('accounting.view')
              or (public.has_permission('billing.charge') and encounter_id is not null)));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (public.can_access_patient(patient_id)
         and (public.has_permission('accounting.create') or public.has_permission('accounting.edit')
              or (public.has_permission('billing.charge') and encounter_id is not null)))
  with check (public.has_permission('accounting.create') or public.has_permission('accounting.edit')
              or (public.has_permission('billing.charge') and encounter_id is not null));
drop policy if exists invoice_lines_write on public.invoice_lines;
create policy invoice_lines_write on public.invoice_lines for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                 and (public.has_permission('accounting.create') or (public.has_permission('billing.charge') and i.encounter_id is not null))))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id
                 and (public.has_permission('accounting.create') or (public.has_permission('billing.charge') and i.encounter_id is not null))));

alter table public.doctor_working_hours enable row level security;
create policy doctor_working_hours_read on public.doctor_working_hours for select to authenticated using (true);
create policy doctor_working_hours_write on public.doctor_working_hours for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

alter table public.doctor_service_prices enable row level security;
create policy doctor_service_prices_read on public.doctor_service_prices for select to authenticated
  using (public.has_permission('pricing.view') or public.has_permission('pricing.manage'));
create policy doctor_service_prices_write on public.doctor_service_prices for all to authenticated
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));

-- Function exposure: internal helpers are not callable by clients.
revoke execute on function public.encounter_invoice_internal(uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.notify_encounter_doctor(uuid) from public, anon, authenticated;
revoke execute on function public.is_first_visit(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.encounter_bill_settled(uuid) from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in select * from (values ('encounters', 'id'), ('doctor_working_hours', 'id')) as x(tbl, key) loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_touch_row()', t.tbl || '_touch', t.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit(%L)', t.tbl || '_audit', t.tbl, t.key);
  end loop;
  execute 'create trigger doctor_service_prices_audit after insert or update or delete on public.doctor_service_prices for each row execute function public.tg_audit(''doctor_id'')';
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'encounters') then
    alter publication supabase_realtime add table public.encounters;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Timeline: clinic visits (arrival, checkout)
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
    from public.generated_documents g where g.patient_id is not null
  union all
  select e.patient_id, 'clinic_visit', e.arrived_at, 'encounter', e.id, e.source, e.status, e.created_by, null
    from public.encounters e
  union all
  select e.patient_id, 'checked_out', e.checked_out_at, 'encounter', e.id, e.source, e.status, e.updated_by, null
    from public.encounters e where e.checked_out_at is not null;
