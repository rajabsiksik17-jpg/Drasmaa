-- =====================================================================
-- 0009 ATOMIC PATIENT REGISTRATION (additive)
-- =====================================================================
-- Registration writes the patient and the husband details in ONE
-- transaction: if any step fails, nothing is kept. SECURITY INVOKER, so
-- the caller's RLS policies and permissions apply to every write. The
-- assigned doctor is decided by the patients_assigned_doctor trigger (0008).
-- =====================================================================

create or replace function public.create_patient(p_patient jsonb, p_husband jsonb default '{}'::jsonb)
returns table (id uuid, patient_code text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
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

  -- The husband row is created by the patients_after_insert trigger.
  if p_husband is not null and p_husband <> '{}'::jsonb then
    update public.patient_husbands h
       set full_name = nullif(p_husband ->> 'full_name', ''),
           dob = nullif(p_husband ->> 'dob', '')::date,
           occupation = nullif(p_husband ->> 'occupation', ''),
           blood_group = nullif(p_husband ->> 'blood_group', ''),
           rh = nullif(p_husband ->> 'rh', '')
     where h.patient_id = v_id;
  end if;

  return query select v_id, v_code;
end;
$$;
