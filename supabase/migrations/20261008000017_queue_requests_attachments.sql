-- =====================================================================
-- 0017 DOCTOR REQUESTS, LIVE QUEUE EVENTS, ATTACHMENTS (additive)
-- ---------------------------------------------------------------------
--  * Doctor "Call patient": waiting_doctor → called (reception is told
--    in realtime and marks the patient as sent) → with_doctor.
--  * Bill-ready event when the doctor finishes a visit with an amount to
--    collect (post-payment workflow, or extra services after pre-payment).
--  * Queue notifications carry operational data only (names, amounts).
--  * Attachments: any configured safe document type, display name,
--    description, document date, tags, investigation link; file identity
--    (patient, path, type, size) can never change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Encounter states: called by doctor
-- ---------------------------------------------------------------------
alter table public.encounters drop constraint if exists encounters_status_check;
alter table public.encounters add constraint encounters_status_check check (status in (
  'waiting_payment', 'waiting_doctor', 'called', 'with_doctor', 'awaiting_checkout', 'checked_out', 'cancelled'));
alter table public.encounters
  add column if not exists called_at timestamptz,
  add column if not exists called_by uuid,
  add column if not exists patient_sent_at timestamptz,
  add column if not exists patient_sent_by uuid;
-- Realtime UPDATE events carry the previous row too (status transitions).
alter table public.encounters replica identity full;

insert into public.notification_event_types (code, category, default_priority, name_en, name_ar, is_critical, email_enabled, sort_order) values
  ('patient_requested', 'appointments', 'high', 'Doctor requested a patient',          'طلب الطبيب دخول مريضة', false, false, 9),
  ('bill_ready',        'appointments', 'high', 'Visit finished — payment required',   'انتهت الزيارة — مطلوب الدفع', false, false, 10)
on conflict (code) do nothing;

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
      when 'waiting_doctor'    then array['waiting_payment', 'called', 'with_doctor', 'cancelled']
      when 'called'            then array['waiting_doctor', 'with_doctor', 'cancelled']
      when 'with_doctor'       then array['waiting_doctor', 'awaiting_checkout']
      when 'awaiting_checkout' then array['with_doctor', 'checked_out']
      else array[]::text[] end;
    if not (new.status = any (v_allowed)) then
      raise exception 'Clinic visit cannot move from % to %.', old.status, new.status
        using errcode = 'P0001', hint = 'INVALID_TRANSITION';
    end if;
    case new.status
      when 'waiting_doctor' then
        new.sent_to_doctor_at := coalesce(old.sent_to_doctor_at, now());
        new.called_at := null; new.called_by := null; new.patient_sent_at := null; new.patient_sent_by := null;
      when 'called' then new.called_at := now(); new.called_by := auth.uid(); new.patient_sent_at := null; new.patient_sent_by := null;
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

-- Operational payload (no clinical details) for queue notifications.
create or replace function public.encounter_payload(p_encounter uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'encounter_id', e.id, 'patient_id', p.id, 'patient_name', p.full_name, 'patient_code', p.patient_code,
           'doctor_name_en', d.display_name_en, 'doctor_name_ar', coalesce(d.display_name_ar, d.display_name_en),
           'amount', to_char(coalesce(i.balance_patient, 0), 'FM999999990.000'), 'currency', coalesce(i.currency, 'JOD'),
           'invoice_id', i.id)
    from public.encounters e
    join public.patients p on p.id = e.patient_id
    left join public.doctors d on d.id = e.doctor_id
    left join public.invoices i on i.encounter_id = e.id and i.status <> 'void'
   where e.id = p_encounter;
$$;
revoke execute on function public.encounter_payload(uuid) from public, anon, authenticated;

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
                               public.encounter_payload(e.id), '/dashboard', e.patient_id, 'encounter', e.id);
  end if;
end;
$$;

-- Doctor: "Call patient now" — reception is told immediately.
create or replace function public.request_patient(p_encounter uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.encounters;
  v_doctor uuid := public.current_doctor_id();
begin
  if not public.has_permission('visits.create') then
    raise exception 'Only doctors can call patients in.' using errcode = '42501';
  end if;
  select * into e from public.encounters where id = p_encounter for update;
  if not found or not public.can_access_patient(e.patient_id) then
    raise exception 'Clinic visit not found.' using errcode = 'P0002';
  end if;
  if e.status not in ('waiting_doctor', 'called') then
    raise exception 'The patient is not waiting for the doctor.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;
  if e.doctor_id is not null and v_doctor is not null and e.doctor_id <> v_doctor and not public.has_permission('settings.manage') then
    raise exception 'This patient is waiting for another doctor.' using errcode = '42501';
  end if;
  if e.status = 'called' then
    update public.encounters set called_at = now(), doctor_id = coalesce(doctor_id, v_doctor) where id = e.id;  -- repeated call
  else
    update public.encounters set status = 'called', doctor_id = coalesce(doctor_id, v_doctor) where id = e.id;
  end if;
  perform public.notify_permission('accounting.create', 'patient_requested', 'Doctor requested a patient', null,
                                   public.encounter_payload(e.id), '/dashboard', e.patient_id, 'encounter', e.id, auth.uid());
end;
$$;

-- Reception: the requested patient is on the way.
create or replace function public.mark_patient_sent(p_encounter uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.encounters;
begin
  if not (public.has_permission('encounters.create') or public.has_permission('appointments.checkin')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into e from public.encounters where id = p_encounter for update;
  if not found or not public.can_access_patient(e.patient_id) then
    raise exception 'Clinic visit not found.' using errcode = 'P0002';
  end if;
  if e.status <> 'called' then
    raise exception 'The doctor has not requested this patient.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;
  update public.encounters set patient_sent_at = now(), patient_sent_by = auth.uid() where id = e.id;
end;
$$;

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
   where id = p_encounter and status in ('waiting_payment', 'waiting_doctor', 'called', 'awaiting_checkout');
end;
$$;

-- Manual moves: a doctor may also put a called patient back to waiting.
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
      if e.status in ('with_doctor', 'called') then
        if not public.has_permission('visits.create') then raise exception 'Not allowed.' using errcode = '42501'; end if;
      else
        if not (public.has_permission('accounting.create') or public.has_permission('encounters.create')) then
          raise exception 'Not allowed.' using errcode = '42501';
        end if;
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

  if p_status = 'waiting_doctor' and e.status = 'waiting_payment' then
    perform public.notify_encounter_doctor(e.id);
  end if;
  if p_status = 'checked_out' and e.appointment_id is not null then
    update public.appointments set status = 'completed' where id = e.appointment_id and status = 'with_doctor';
  end if;
end;
$$;

-- Doctor finished: if there is something to collect, reception is told now
-- (this is the moment the final bill becomes the reception's task).
create or replace function public.tg_encounters_bill_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'awaiting_checkout' and old.status is distinct from 'awaiting_checkout'
     and not public.encounter_bill_settled(new.id) then
    perform public.notify_permission('accounting.create', 'bill_ready', 'Visit finished — payment required', null,
                                     public.encounter_payload(new.id), '/dashboard', new.patient_id, 'encounter', new.id, auth.uid());
  end if;
  return new;
end;
$$;
create trigger encounters_bill_ready after update of status on public.encounters
  for each row execute function public.tg_encounters_bill_ready();

-- ---------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------
alter table public.documents drop constraint if exists documents_category_check;
alter table public.documents add constraint documents_category_check check (category in (
  'sfa', 'ivf_consent', 'investigation', 'ultrasound', 'medical', 'lab', 'imaging', 'referral', 'previous_report', 'identity', 'other'));
alter table public.documents drop constraint if exists documents_mime_type_check;
alter table public.documents add constraint documents_mime_type_check check (mime_type in (
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
alter table public.documents
  add column if not exists document_date date,
  add column if not exists tags text[] not null default '{}' check (cardinality(tags) <= 20),
  add column if not exists investigation_id uuid references public.investigations(id);
create index if not exists documents_investigation_idx on public.documents(investigation_id);

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
     'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
 where id = 'patient-documents';

-- The file itself is immutable; only its description (metadata) can change.
create or replace function public.tg_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.patient_id <> old.patient_id or new.storage_path <> old.storage_path or new.file_name <> old.file_name
     or new.mime_type <> old.mime_type or new.size_bytes <> old.size_bytes or new.uploaded_by is distinct from old.uploaded_by
     or new.uploaded_at <> old.uploaded_at then
    raise exception 'The stored file cannot be changed; upload a new file instead.' using errcode = '42501';
  end if;
  if new.visit_id is not null and public.visit_patient(new.visit_id) <> new.patient_id then
    raise exception 'The visit belongs to another patient.' using errcode = '42501';
  end if;
  if new.investigation_id is not null
     and (select patient_id from public.investigations where id = new.investigation_id) <> new.patient_id then
    raise exception 'The investigation belongs to another patient.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_guard on public.documents;
create trigger documents_guard before update on public.documents
  for each row execute function public.tg_documents_guard();
