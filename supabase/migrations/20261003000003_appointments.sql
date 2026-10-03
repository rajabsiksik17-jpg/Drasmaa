-- =====================================================================
-- 0003 APPOINTMENTS, REMINDERS, NOTIFICATIONS
-- =====================================================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  doctor_id uuid not null references public.doctors(id),
  department_id uuid not null references public.departments(id),
  visit_type text not null,                -- dropdown_options(category='appointment_type')
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 15 check (duration_minutes between 5 and 480),
  ends_at timestamptz not null,            -- maintained by trigger (needed by the exclusion constraint)
  status text not null default 'scheduled'
    check (status in ('scheduled', 'checked_in', 'with_doctor', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  notes text,
  payment_method text check (payment_method in ('cash', 'insurance')),
  insurance_company_id uuid references public.insurance_companies(id),
  checked_in_at timestamptz,
  with_doctor_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  rescheduled_from_id uuid references public.appointments(id),
  source_visit_id uuid,                    -- FK added in 0004 (follow-up created from a visit)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

-- Database-level protection against double-booking the same doctor,
-- independent of any frontend validation or concurrent receptionists.
alter table public.appointments
  add constraint appointments_no_double_booking
  exclude using gist (
    doctor_id with =,
    tstzrange(scheduled_at, ends_at, '[)') with &&
  ) where (status in ('scheduled', 'checked_in', 'with_doctor', 'completed'));

create index appointments_patient_idx on public.appointments(patient_id, scheduled_at desc);
create index appointments_doctor_idx on public.appointments(doctor_id, scheduled_at);
create index appointments_department_idx on public.appointments(department_id);
create index appointments_scheduled_idx on public.appointments(scheduled_at);
create index appointments_status_idx on public.appointments(status, scheduled_at);
create index appointments_rescheduled_from_idx on public.appointments(rescheduled_from_id);

-- Controlled state machine + timestamps.
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
create trigger appointments_before before insert or update on public.appointments
  for each row execute function public.tg_appointments_before();

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'appointment_reminder', 'patient_checked_in', 'appointment_created',
    'appointment_rescheduled', 'appointment_cancelled', 'system')),
  -- English fallback text; clients render localized text from `type`+`data`.
  title text not null,
  message text,
  data jsonb not null default '{}'::jsonb,
  entity_type text,
  entity_id uuid,
  patient_id uuid references public.patients(id) on delete cascade,
  read_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications(recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications(recipient_id) where read_at is null and voided_at is null;
create index notifications_entity_idx on public.notifications(entity_id);

create table public.appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  remind_on date not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'skipped')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index appointment_reminders_due_idx on public.appointment_reminders(remind_on) where status = 'pending';

create or replace function public.appointment_payload(p_appointment uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'appointment_id', a.id,
    'patient_id', p.id,
    'patient_name', p.full_name,
    'patient_code', p.patient_code,
    'scheduled_at', a.scheduled_at,
    'doctor_name_en', d.display_name_en,
    'doctor_name_ar', coalesce(d.display_name_ar, d.display_name_en),
    'visit_type', a.visit_type,
    'visit_type_en', coalesce(o.label_en, a.visit_type),
    'visit_type_ar', coalesce(o.label_ar, a.visit_type)
  )
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  join public.doctors d on d.id = a.doctor_id
  left join public.dropdown_options o on o.category = 'appointment_type' and o.value = a.visit_type
  where a.id = p_appointment;
$$;

-- Sends due reminders (idempotent). Called by triggers for same-day
-- bookings of tomorrow's appointments and by the scheduler (pg_cron or
-- /api/cron/reminders) for everything else.
create or replace function public.process_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone public.clinic_timezone())::date;
  v_count integer := 0;
  r record;
  v_payload jsonb;
begin
  -- Appointments whose day already arrived get no "tomorrow" reminder.
  update public.appointment_reminders ar
     set status = 'skipped'
    from public.appointments a
   where a.id = ar.appointment_id
     and ar.status = 'pending'
     and (a.scheduled_at at time zone public.clinic_timezone())::date <= v_today;

  for r in
    select ar.id, ar.appointment_id
      from public.appointment_reminders ar
      join public.appointments a on a.id = ar.appointment_id
     where ar.status = 'pending'
       and ar.remind_on <= v_today
       and a.status in ('scheduled', 'checked_in')
     for update of ar skip locked
  loop
    v_payload := public.appointment_payload(r.appointment_id);
    insert into public.notifications (recipient_id, type, title, message, data, entity_type, entity_id, patient_id)
    select pr.id, 'appointment_reminder', 'Tomorrow''s appointment',
           format('%s — %s with %s (%s)', v_payload ->> 'patient_name',
                  to_char((v_payload ->> 'scheduled_at')::timestamptz at time zone public.clinic_timezone(), 'HH12:MI AM'),
                  v_payload ->> 'doctor_name_en', v_payload ->> 'visit_type_en'),
           v_payload, 'appointment', r.appointment_id, (v_payload ->> 'patient_id')::uuid
      from public.profiles pr
      join public.role_permissions rp on rp.role_id = pr.role_id and rp.permission_code = 'appointments.reminders'
     where pr.active;
    update public.appointment_reminders set status = 'sent', sent_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.notify_doctor(p_appointment uuid, p_type text, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := public.appointment_payload(p_appointment);
  v_profile uuid;
begin
  select d.profile_id into v_profile
    from public.appointments a join public.doctors d on d.id = a.doctor_id
   where a.id = p_appointment;
  if v_profile is null or v_profile = auth.uid() then
    return;  -- no login for this doctor, or the doctor did it themself
  end if;
  insert into public.notifications (recipient_id, type, title, message, data, entity_type, entity_id, patient_id)
  values (v_profile, p_type, p_title,
          format('%s — %s', v_payload ->> 'patient_name',
                 to_char((v_payload ->> 'scheduled_at')::timestamptz at time zone public.clinic_timezone(), 'DD/MM HH12:MI AM')),
          v_payload, 'appointment', p_appointment, (v_payload ->> 'patient_id')::uuid);
end;
$$;

create or replace function public.tg_appointments_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remind_on date;
begin
  if tg_op = 'INSERT' then
    v_remind_on := (new.scheduled_at at time zone public.clinic_timezone())::date - 1;
    insert into public.appointment_reminders (appointment_id, remind_on)
    values (new.id, v_remind_on)
    on conflict (appointment_id) do nothing;
    perform public.process_due_reminders();

    if new.rescheduled_from_id is not null then
      perform public.notify_doctor(new.id, 'appointment_rescheduled', 'Appointment rescheduled');
    else
      perform public.notify_doctor(new.id, 'appointment_created', 'New appointment');
    end if;
    if new.status = 'checked_in' then
      perform public.notify_doctor(new.id, 'patient_checked_in', 'New patient waiting');
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status in ('cancelled', 'no_show', 'rescheduled') then
      update public.appointment_reminders set status = 'cancelled'
       where appointment_id = new.id and status = 'pending';
      -- Hide an already-delivered reminder for an appointment that will no longer happen.
      update public.notifications set voided_at = now()
       where entity_id = new.id and type = 'appointment_reminder' and voided_at is null;
    end if;
    if new.status = 'checked_in' and old.status = 'scheduled' then
      perform public.notify_doctor(new.id, 'patient_checked_in', 'New patient waiting');
    elsif new.status = 'cancelled' then
      perform public.notify_doctor(new.id, 'appointment_cancelled', 'Appointment cancelled');
    end if;
  end if;
  return new;
end;
$$;
create trigger appointments_after after insert or update on public.appointments
  for each row execute function public.tg_appointments_after();

-- Rescheduling preserves history: the old appointment becomes
-- RESCHEDULED and a new SCHEDULED appointment is created (atomically).
-- SECURITY INVOKER: row-level security applies to the caller.
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_doctor_id uuid default null,
  p_duration_minutes integer default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.appointments;
  v_new uuid;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found.' using errcode = 'P0002';
  end if;
  if v_old.status not in ('scheduled', 'checked_in') then
    raise exception 'Only scheduled or waiting appointments can be rescheduled.'
      using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;

  update public.appointments set status = 'rescheduled' where id = p_appointment_id;

  insert into public.appointments (
    patient_id, doctor_id, department_id, visit_type, scheduled_at, duration_minutes,
    notes, payment_method, insurance_company_id, rescheduled_from_id, source_visit_id)
  values (
    v_old.patient_id, coalesce(p_doctor_id, v_old.doctor_id), v_old.department_id, v_old.visit_type,
    p_scheduled_at, coalesce(p_duration_minutes, v_old.duration_minutes),
    coalesce(p_notes, v_old.notes), v_old.payment_method, v_old.insurance_company_id,
    v_old.id, v_old.source_visit_id)
  returning id into v_new;
  return v_new;
end;
$$;

-- Dashboard counters for a clinic-local day.
create or replace function public.appointment_counts(p_day date default null, p_doctor uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with d as (
    select coalesce(p_day, (now() at time zone public.clinic_timezone())::date) as day
  ), a as (
    select a.status, (a.scheduled_at at time zone public.clinic_timezone())::date as day
      from public.appointments a, d
     where a.scheduled_at >= (d.day::timestamp at time zone public.clinic_timezone())
       and a.scheduled_at <  ((d.day + 2)::timestamp at time zone public.clinic_timezone())
       and (p_doctor is null or a.doctor_id = p_doctor)
  )
  select jsonb_build_object(
    'today_total',       count(*) filter (where a.day = d.day and a.status not in ('cancelled', 'rescheduled')),
    'scheduled',         count(*) filter (where a.day = d.day and a.status = 'scheduled'),
    'waiting',           count(*) filter (where a.day = d.day and a.status = 'checked_in'),
    'with_doctor',       count(*) filter (where a.day = d.day and a.status = 'with_doctor'),
    'completed',         count(*) filter (where a.day = d.day and a.status = 'completed'),
    'no_show',           count(*) filter (where a.day = d.day and a.status = 'no_show'),
    'cancelled',         count(*) filter (where a.day = d.day and a.status = 'cancelled'),
    'tomorrow',          count(*) filter (where a.day = d.day + 1 and a.status in ('scheduled', 'checked_in'))
  )
  from d left join a on true
  group by d.day;
$$;
