-- =====================================================================
-- DEVELOPMENT SEED DATA — fictional people only. Never run in production.
-- Loaded automatically by `supabase db reset` (local development).
--
-- Test logins (password for all: ClinicDev#2026):
--   admin@clinic.test    — Administrator
--   doctor@clinic.test   — Doctor (ART)
--   gyn@clinic.test      — Doctor (Gynecology)
--   desk@clinic.test     — Receptionist
-- =====================================================================

do $$
declare
  u record;
begin
  for u in select * from (values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@clinic.test',  'admin',        'Clinic Admin',      'مدير العيادة',  null::text),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'doctor@clinic.test', 'doctor',       'Dr. Maya Haddad',   'د. مايا حداد',  'art'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'gyn@clinic.test',    'doctor',       'Dr. Rami Saleh',    'د. رامي صالح',  'gynecology'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'desk@clinic.test',   'receptionist', 'Noor (Reception)',  'نور (الاستقبال)', null)
  ) as t(id, email, role, name, name_ar, dept)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token)
    values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('ClinicDev#2026', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', u.role,
                         'department_id', (select id from public.departments where code = u.dept)),
      jsonb_build_object('full_name', u.name, 'full_name_ar', u.name_ar),
      now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', u.id::text, now(), now(), now())
    on conflict do nothing;
  end loop;
end;
$$;

insert into public.insurance_companies (code, name_en, name_ar, sort_order) values
  ('demo_a', 'Demo Insurance A', 'تأمين تجريبي أ', 1),
  ('demo_b', 'Demo Insurance B', 'تأمين تجريبي ب', 2),
  ('demo_c', 'Demo Insurance C (inactive)', 'تأمين تجريبي ج (غير فعال)', 3)
on conflict (code) do nothing;
update public.insurance_companies set active = false where code = 'demo_c';

update public.clinic_settings
   set clinic_name_en = 'Demo Women''s Health Clinic',
       clinic_name_ar = 'عيادة تجريبية لصحة المرأة',
       phone = '+962 6 000 0000',
       address_en = 'Amman, Jordan',
       address_ar = 'عمّان، الأردن'
 where id = 1;

-- Sample patients, appointments and history (fictional).
do $$
declare
  v_desk uuid := '00000000-0000-4000-a000-000000000004';
  v_doc uuid := (select id from public.doctors where profile_id = '00000000-0000-4000-a000-000000000002');
  v_gyn uuid := (select id from public.doctors where profile_id = '00000000-0000-4000-a000-000000000003');
  v_art uuid := (select id from public.departments where code = 'art');
  v_gyd uuid := (select id from public.departments where code = 'gynecology');
  v_today date := (now() at time zone 'Asia/Amman')::date;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  v_case uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_desk)::text, true);

  insert into public.patients (full_name, dob, occupation, phone, address, marriage_date, blood_group, rh)
  values ('Sample Patient One', '1994-06-14', 'Teacher', '0790000001', 'Amman — Sample St. 1', '2020-05-12', 'A', '+')
  returning id into p1;
  insert into public.patients (full_name, dob, occupation, phone, address, marriage_date, blood_group, rh, payment_method, insurance_company_id)
  values ('Sample Patient Two', '1989-02-03', 'Engineer', '0790000002', 'Amman — Sample St. 2', '2015-09-01', 'O', '-',
          'insurance', (select id from public.insurance_companies where code = 'demo_a'))
  returning id into p2;
  insert into public.patients (full_name, dob, phone, address)
  values ('Sample Patient Three', '1998-11-21', '0790000003', 'Zarqa — Sample St. 3') returning id into p3;
  insert into public.patients (full_name, dob, phone, address)
  values ('Sample Patient Four', '1985-01-30', '0790000004', 'Irbid — Sample St. 4') returning id into p4;

  update public.patient_husbands set full_name = 'Sample Husband One', dob = '1990-03-02', occupation = 'Accountant', blood_group = 'B', rh = '+' where patient_id = p1;
  update public.patient_husbands set full_name = 'Sample Husband Two', dob = '1986-07-19', blood_group = 'O', rh = '+' where patient_id = p2;
  update public.patient_allergies set allergy = 'Penicillin' where patient_id = p1;
  update public.patient_medical_history set ht = false, dm = false, hypothyroidism = true, notes = 'On thyroxine 50 mcg' where patient_id = p1;
  update public.patient_menstrual_history set menarche_age = 13, regular_cycle = true, period_duration = 5, cycle_frequency = 28, lmp = v_today - 10 where patient_id = p1;
  update public.patient_obstetric_history set gravida = 1, para = 0, miscarriages = 1, miscarriages_first_trimester = 1 where patient_id = p1;
  update public.patient_obstetric_history set gravida = 2, para = 1, normal_deliveries = 1, living_female = 1 where patient_id = p2;

  insert into public.investigation_results (patient_id, type_code, value_numeric, result_date) values
    (p1, 'amh', 1.4, v_today - 240), (p1, 'amh', 1.1, v_today - 30),
    (p1, 'tsh', 2.1, v_today - 30), (p1, 'prl', 14.0, v_today - 30), (p1, 'fsh', 7.2, v_today - 30),
    (p1, 'lh', 5.1, v_today - 30), (p1, 'e2', 41, v_today - 30), (p1, 'vitd', 18, v_today - 30);

  -- Today: one waiting, others scheduled; tomorrow: two.
  insert into public.appointments (patient_id, doctor_id, department_id, visit_type, scheduled_at, status) values
    (p1, v_doc, v_art, 'fertility',  (v_today + time '10:00') at time zone 'Asia/Amman', 'checked_in'),
    (p2, v_doc, v_art, 'pregnancy',  (v_today + time '10:30') at time zone 'Asia/Amman', 'scheduled'),
    (p3, v_gyn, v_gyd, 'gynecology', (v_today + time '11:00') at time zone 'Asia/Amman', 'scheduled'),
    (p4, v_doc, v_art, 'consultation', (v_today + 1 + time '09:30') at time zone 'Asia/Amman', 'scheduled'),
    (p3, v_gyn, v_gyd, 'gynecology', (v_today + 1 + time '17:30') at time zone 'Asia/Amman', 'scheduled'),
    (p2, v_doc, v_art, 'pregnancy',  (v_today + 14 + time '12:00') at time zone 'Asia/Amman', 'scheduled');

  -- A previous pregnancy case for patient two.
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-a000-000000000002')::text, true);
  insert into public.pregnancy_cases (patient_id, lmp, edd, history) values (p2, v_today - 70, v_today - 70 + 280, 'Previous NVD 2019')
  returning id into v_case;
  insert into public.pregnancy_followups (pregnancy_case_id, followup_date, weight_kg, bp_systolic, bp_diastolic, complaint, ultrasound, plan)
  values (v_case, v_today - 35, 64.5, 110, 70, 'Nausea', 'Single viable IUP, CRL 1.2 cm', 'Folic acid, review 4 weeks');

  perform set_config('request.jwt.claims', '', true);
end;
$$;
