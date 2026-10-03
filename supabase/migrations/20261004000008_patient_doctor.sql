-- =====================================================================
-- 0008 ASSIGNED DOCTOR (additive)
-- =====================================================================
-- Business rule (enforced here, not only in the UI):
--   exactly 1 active doctor  -> every new patient is assigned to that doctor
--   2+ active doctors        -> the chosen doctor is kept (optional)
--   0 active doctors         -> the patient is created without a doctor
-- =====================================================================

alter table public.patients
  add column assigned_doctor_id uuid references public.doctors(id);

create index patients_assigned_doctor_idx on public.patients(assigned_doctor_id);

create or replace function public.tg_patients_assigned_doctor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_only uuid;
begin
  if tg_op = 'INSERT' then
    select count(*), (array_agg(id))[1] into v_count, v_only from public.doctors where active;
    if v_count = 1 then
      new.assigned_doctor_id := v_only;
      return new;
    elsif v_count = 0 then
      new.assigned_doctor_id := null;
      return new;
    end if;
  elsif new.assigned_doctor_id is not distinct from old.assigned_doctor_id then
    return new;
  end if;

  if new.assigned_doctor_id is not null
     and not exists (select 1 from public.doctors where id = new.assigned_doctor_id and active) then
    raise exception 'The selected doctor is not active.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger patients_assigned_doctor
  before insert or update of assigned_doctor_id on public.patients
  for each row execute function public.tg_patients_assigned_doctor();

-- The assigned doctor can always open the patient (also under the
-- "assigned" / "department" access scopes).
create or replace function public.can_access_patient(p_patient uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_doctor uuid;
  v_dept uuid;
begin
  if auth.uid() is null or p_patient is null then
    return false;
  end if;
  if not public.has_permission('patients.view') then
    return false;
  end if;
  if public.has_permission('patients.view_all') then
    return true;
  end if;
  select doctor_access_scope into v_scope from public.clinic_settings where id = 1;
  if coalesce(v_scope, 'all') = 'all' then
    return true;
  end if;
  if exists (select 1 from public.patients p where p.id = p_patient and p.created_by = auth.uid()) then
    return true;
  end if;
  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    return false;
  end if;
  if exists (select 1 from public.patients p where p.id = p_patient and p.assigned_doctor_id = v_doctor)
     or exists (select 1 from public.appointments a where a.patient_id = p_patient and a.doctor_id = v_doctor)
     or exists (select 1 from public.visits v where v.patient_id = p_patient and v.doctor_id = v_doctor) then
    return true;
  end if;
  if v_scope = 'department' then
    select department_id into v_dept from public.doctors where id = v_doctor;
    return exists (select 1 from public.appointments a where a.patient_id = p_patient and a.department_id = v_dept);
  end if;
  return false;
end;
$$;
