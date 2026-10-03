-- =====================================================================
-- 0006 ROW LEVEL SECURITY
-- =====================================================================
-- Every table has RLS enabled. Access = permission (configurable per
-- role by the administrator) AND patient access scope
-- (clinic_settings.doctor_access_scope: all | department | assigned).
-- There are intentionally NO delete policies on clinical tables.
-- =====================================================================

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
  if exists (select 1 from public.appointments a where a.patient_id = p_patient and a.doctor_id = v_doctor)
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

create or replace function public.recent_window_start()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select now() - make_interval(days => coalesce((select receptionist_history_days from public.clinic_settings where id = 1), 30));
$$;

-- ---------------------------------------------------------------------
-- Configuration tables: readable by every signed-in user.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
    ('roles', 'roles.manage'),
    ('permissions', 'roles.manage'),
    ('role_permissions', 'roles.manage'),
    ('departments', 'settings.manage'),
    ('doctors', 'settings.manage'),
    ('insurance_companies', 'settings.manage'),
    ('dropdown_options', 'settings.manage'),
    ('clinic_settings', 'settings.manage'),
    ('form_definitions', 'settings.manage'),
    ('investigation_types', 'settings.manage')
  ) as t(tbl, perm)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (true)', r.tbl || '_read', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(%L))', r.tbl || '_insert', r.tbl, r.perm);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(%L)) with check (public.has_permission(%L))', r.tbl || '_update', r.tbl, r.perm, r.perm);
  end loop;
end;
$$;
-- Toggling a permission off removes the grant row.
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated using (public.has_permission('roles.manage'));

-- ---------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));

-- ---------------------------------------------------------------------
-- Patients (administrative data)
-- ---------------------------------------------------------------------
alter table public.patients enable row level security;
create policy patients_select on public.patients for select to authenticated
  using (public.can_access_patient(id));
create policy patients_insert on public.patients for insert to authenticated
  with check (public.has_permission('patients.create'));
create policy patients_update on public.patients for update to authenticated
  using (public.has_permission('patients.edit') and public.can_access_patient(id))
  with check (public.has_permission('patients.edit') and (status = 'active' or public.has_permission('patients.archive')));

alter table public.patient_husbands enable row level security;
create policy patient_husbands_select on public.patient_husbands for select to authenticated
  using (public.can_access_patient(patient_id));
create policy patient_husbands_insert on public.patient_husbands for insert to authenticated
  with check (public.has_permission('patients.edit') and public.can_access_patient(patient_id));
create policy patient_husbands_update on public.patient_husbands for update to authenticated
  using (public.has_permission('patients.edit') and public.can_access_patient(patient_id))
  with check (public.has_permission('patients.edit'));

-- Drug allergy is a safety warning: visible with allergy.view.
alter table public.patient_allergies enable row level security;
create policy patient_allergies_select on public.patient_allergies for select to authenticated
  using ((public.has_permission('allergy.view') or public.has_permission('medical_history.view'))
         and public.can_access_patient(patient_id));
create policy patient_allergies_insert on public.patient_allergies for insert to authenticated
  with check (public.has_permission('medical_history.edit') and public.can_access_patient(patient_id));
create policy patient_allergies_update on public.patient_allergies for update to authenticated
  using (public.has_permission('medical_history.edit') and public.can_access_patient(patient_id))
  with check (public.has_permission('medical_history.edit'));

-- ---------------------------------------------------------------------
-- Clinical tables: generated policies (select / insert / update)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
    ('patient_medical_history',     'medical_history', 'patient_id'),
    ('patient_surgical_history',    'medical_history', 'patient_id'),
    ('patient_medications',         'medical_history', 'patient_id'),
    ('patient_family_history',      'medical_history', 'patient_id'),
    ('patient_social_history',      'medical_history', 'patient_id'),
    ('patient_menstrual_history',   'medical_history', 'patient_id'),
    ('patient_obstetric_history',   'medical_history', 'patient_id'),
    ('fertility_cases',             'fertility',       'patient_id'),
    ('pregnancy_cases',             'pregnancy',       'patient_id'),
    ('investigations',              'investigations',  'patient_id'),
    ('investigation_results',       'investigations',  'patient_id'),
    ('ivf_consents',                'fertility',       'patient_id'),
    ('fertility_cycles',            'oi',              'patient_id'),
    ('ultrasound_annotations',      'gynecology',      'patient_id'),
    ('visit_clinical',              'visits',          'public.visit_patient(visit_id)'),
    ('gynecology_visits',           'gynecology',      'public.visit_patient(visit_id)'),
    ('fertility_visits',            'fertility',       'public.visit_patient(visit_id)'),
    ('fertility_husband_data',      'fertility',       'public.visit_patient(visit_id)'),
    ('fertility_wife_data',         'fertility',       'public.visit_patient(visit_id)'),
    ('pregnancy_followups',         'pregnancy',       'public.pregnancy_case_patient(pregnancy_case_id)'),
    ('fertility_cycle_days',        'oi',              'public.cycle_patient(cycle_id)'),
    ('fertility_cycle_medications', 'oi',              'public.cycle_patient(cycle_id)'),
    ('fertility_cycle_hormones',    'oi',              'public.cycle_patient(cycle_id)'),
    ('fertility_cycle_follicles',   'oi',              'public.cycle_patient(cycle_id)'),
    ('fertility_cycle_endometrium', 'oi',              'public.cycle_patient(cycle_id)')
  ) as t(tbl, perm, patient_expr)
  loop
    -- visit_clinical uses visits.view / visits.edit
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_permission(%L) and public.can_access_patient(%s))',
      r.tbl || '_select', r.tbl, r.perm || '.view', r.patient_expr);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_permission(%L) and public.can_access_patient(%s))',
      r.tbl || '_insert', r.tbl, r.perm || '.edit', r.patient_expr);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_permission(%L) and public.can_access_patient(%s)) with check (public.has_permission(%L))',
      r.tbl || '_update', r.tbl, r.perm || '.edit', r.patient_expr, r.perm || '.edit');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Visits: full access with visits.view; receptionists see a recent list
-- (metadata only - clinical content lives in child tables).
-- ---------------------------------------------------------------------
alter table public.visits enable row level security;
create policy visits_select on public.visits for select to authenticated
  using (
    public.can_access_patient(patient_id)
    and (public.has_permission('visits.view')
         or (public.has_permission('visits.view_recent') and started_at >= public.recent_window_start()))
  );
create policy visits_insert on public.visits for insert to authenticated
  with check (public.has_permission('visits.create') and public.can_access_patient(patient_id));
create policy visits_update on public.visits for update to authenticated
  using (public.has_permission('visits.edit') and public.can_access_patient(patient_id))
  with check (public.has_permission('visits.edit'));

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
alter table public.appointments enable row level security;
create policy appointments_select on public.appointments for select to authenticated
  using (
    public.has_permission('appointments.view')
    and (public.can_access_patient(patient_id) or doctor_id = public.current_doctor_id())
    and (public.has_permission('appointments.view_history') or scheduled_at >= public.recent_window_start())
  );
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_permission('appointments.create') and public.can_access_patient(patient_id));
-- Status changes are additionally limited per target status below.
create policy appointments_update on public.appointments for update to authenticated
  using (
    (public.has_permission('appointments.edit') or public.has_permission('appointments.checkin')
     or public.has_permission('appointments.cancel'))
    and (public.can_access_patient(patient_id) or doctor_id = public.current_doctor_id())
  )
  with check (
    case status
      when 'cancelled' then public.has_permission('appointments.cancel')
      when 'no_show' then public.has_permission('appointments.cancel')
      when 'checked_in' then public.has_permission('appointments.checkin') or public.has_permission('appointments.edit')
      when 'scheduled' then public.has_permission('appointments.checkin') or public.has_permission('appointments.edit')
      else public.has_permission('appointments.edit')
    end
  );

alter table public.appointment_reminders enable row level security;
create policy appointment_reminders_select on public.appointment_reminders for select to authenticated
  using (public.has_permission('appointments.view'));

-- ---------------------------------------------------------------------
-- Notifications: own only. Created by triggers (security definer).
-- ---------------------------------------------------------------------
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------
-- Documents: clinical viewers, or the uploader for their own uploads.
-- ---------------------------------------------------------------------
alter table public.documents enable row level security;
create policy documents_select on public.documents for select to authenticated
  using (public.can_access_patient(patient_id)
         and (public.has_permission('documents.view') or uploaded_by = auth.uid()));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.has_permission('documents.upload') and public.can_access_patient(patient_id)
              and uploaded_by = auth.uid());
create policy documents_update on public.documents for update to authenticated
  using (public.can_access_patient(patient_id)
         and (public.has_permission('documents.archive') or uploaded_by = auth.uid()))
  with check (status = 'active' or public.has_permission('documents.archive'));

-- ---------------------------------------------------------------------
-- Audit log: read-only for auditors; written by triggers only.
-- ---------------------------------------------------------------------
alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.has_permission('audit.view'));
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;
revoke delete, truncate on public.notifications, public.appointment_reminders from anon, authenticated;

-- Function execution: anon never needs these.
revoke execute on function public.process_due_reminders() from public, anon, authenticated;
revoke execute on function public.notify_doctor(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.appointment_payload(uuid) from public, anon;
