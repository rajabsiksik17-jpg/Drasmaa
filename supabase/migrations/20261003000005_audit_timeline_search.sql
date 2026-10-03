-- =====================================================================
-- 0005 AUDIT, TOUCH TRIGGERS, TIMELINE, SEARCH
-- =====================================================================

create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity_type text not null,
  entity_id text,
  patient_id uuid,
  before jsonb,
  after jsonb,
  changed_fields text[],
  reason text
);
create index audit_logs_occurred_idx on public.audit_logs(occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index audit_logs_patient_idx on public.audit_logs(patient_id, occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, occurred_at desc);

-- Audit rows are append-only, for everybody.
create or replace function public.tg_audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit log entries are immutable.' using errcode = '42501';
end;
$$;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.tg_audit_logs_immutable();

create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := coalesce(tg_argv[0], 'id');
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_changed text[];
  v_patient uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  v_row := coalesce(v_after, v_before);

  if tg_op = 'UPDATE' then
    select array_agg(e.key order by e.key) into v_changed
      from jsonb_each(v_after) e
     where e.value is distinct from (v_before -> e.key)
       and e.key not in ('updated_at', 'updated_by', 'version');
    if v_changed is null then
      return new;  -- nothing meaningful changed
    end if;
  end if;

  -- Resolve the patient for patient-scoped audit browsing.
  if tg_table_name = 'patients' then
    v_patient := (v_row ->> 'id')::uuid;
  elsif v_row ? 'patient_id' then
    v_patient := (v_row ->> 'patient_id')::uuid;
  elsif v_row ? 'cycle_id' then
    v_patient := public.cycle_patient((v_row ->> 'cycle_id')::uuid);
  elsif v_row ? 'visit_id' and v_row ->> 'visit_id' is not null then
    v_patient := public.visit_patient((v_row ->> 'visit_id')::uuid);
  elsif v_row ? 'pregnancy_case_id' then
    v_patient := public.pregnancy_case_patient((v_row ->> 'pregnancy_case_id')::uuid);
  elsif v_row ? 'fertility_case_id' then
    v_patient := public.fertility_case_patient((v_row ->> 'fertility_case_id')::uuid);
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, patient_id,
                                 before, after, changed_fields, reason)
  values (auth.uid(), public.current_role_code(), lower(tg_op), tg_table_name, v_row ->> v_key, v_patient,
          v_before, v_after, v_changed, public.request_audit_reason());
  return coalesce(new, old);
end;
$$;

-- Touch (version/updated_at) + audit on every mutable table.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('roles', 'id'), ('departments', 'id'), ('profiles', 'id'), ('doctors', 'id'),
      ('insurance_companies', 'id'), ('dropdown_options', 'id'), ('clinic_settings', 'id'),
      ('patients', 'id'), ('patient_husbands', 'patient_id'), ('patient_medical_history', 'patient_id'),
      ('patient_surgical_history', 'patient_id'), ('patient_medications', 'patient_id'),
      ('patient_allergies', 'patient_id'), ('patient_family_history', 'patient_id'),
      ('patient_social_history', 'patient_id'), ('patient_menstrual_history', 'patient_id'),
      ('patient_obstetric_history', 'patient_id'),
      ('appointments', 'id'),
      ('fertility_cases', 'id'), ('pregnancy_cases', 'id'), ('visits', 'id'), ('visit_clinical', 'visit_id'),
      ('gynecology_visits', 'visit_id'), ('ultrasound_annotations', 'id'), ('fertility_visits', 'visit_id'),
      ('fertility_husband_data', 'visit_id'), ('fertility_wife_data', 'visit_id'),
      ('pregnancy_followups', 'id'), ('investigations', 'id'), ('investigation_results', 'id'),
      ('documents', 'id'), ('ivf_consents', 'id'), ('fertility_cycles', 'id'),
      ('fertility_cycle_days', 'id'), ('fertility_cycle_medications', 'id'), ('fertility_cycle_hormones', 'id'),
      ('fertility_cycle_follicles', 'id'), ('fertility_cycle_endometrium', 'id')
    ) as t(tbl, key)
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_touch_row()',
                   r.tbl || '_touch', r.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit(%L)',
                   r.tbl || '_audit', r.tbl, r.key);
  end loop;
end;
$$;

-- Permission changes are audited too (composite key).
create or replace function public.tg_audit_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, before, after, reason)
  values (auth.uid(), public.current_role_code(), lower(tg_op), 'role_permissions',
          (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_code'),
          case when tg_op = 'DELETE' then v_row end,
          case when tg_op = 'INSERT' then v_row end,
          public.request_audit_reason());
  return coalesce(new, old);
end;
$$;
create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function public.tg_audit_role_permissions();

-- ---------------------------------------------------------------------
-- Timeline: generated from the real entities (references only).
-- security_invoker => each source table's RLS applies to the viewer.
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
    from public.documents d;

-- ---------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------
create or replace function public.search_patients(p_query text, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, patient_code text, full_name text, dob date, phone text, status text, rank real, total bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (
    select btrim(coalesce(p_query, '')) as raw,
           regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits
  ), m as (
    select p.*,
           (case when upper(p.patient_code) = upper(q.raw) then 3 else 0 end
            + case when length(q.digits) >= 3 and p.phone_normalized like '%' || q.digits || '%' then 2 else 0 end
            + similarity(p.full_name, q.raw))::real as rank
      from public.patients p, q
     where q.raw = ''
        or p.patient_code ilike '%' || q.raw || '%'
        or p.full_name ilike '%' || q.raw || '%'
        or p.full_name % q.raw
        or (length(q.digits) >= 3 and p.phone_normalized like '%' || q.digits || '%')
  )
  select m.id, m.patient_code, m.full_name, m.dob, m.phone, m.status, m.rank, count(*) over () as total
    from m
   order by (m.status = 'active') desc, m.rank desc, m.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

-- Duplicate detection before registration.
create or replace function public.find_possible_duplicates(p_name text, p_phone text default null, p_dob date default null)
returns table (
  id uuid, patient_code text, full_name text, dob date, phone text, reasons text[], score real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (
    select btrim(coalesce(p_name, '')) as name,
           right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9) as phone9,
           p_dob as dob
  ), c as (
    select p.*,
           similarity(p.full_name, q.name) as sim,
           (length(q.phone9) >= 7 and right(p.phone_normalized, 9) = q.phone9) as phone_match,
           (q.dob is not null and p.dob = q.dob) as dob_match
      from public.patients p, q
     where (length(q.phone9) >= 7 and right(p.phone_normalized, 9) = q.phone9)
        or (q.name <> '' and (p.full_name % q.name or p.full_name ilike '%' || q.name || '%'))
        or (q.dob is not null and p.dob = q.dob and similarity(p.full_name, q.name) > 0.2)
  )
  select c.id, c.patient_code, c.full_name, c.dob, c.phone,
         array_remove(array[
           case when c.phone_match then 'phone' end,
           case when c.sim >= 0.45 or c.full_name ilike '%' || (select name from q) || '%' then 'name' end,
           case when c.dob_match then 'dob' end], null) as reasons,
         (c.sim + case when c.phone_match then 1 else 0 end + case when c.dob_match then 0.6 else 0 end)::real as score
    from c
   order by score desc
   limit 10;
$$;

-- Global search for the command palette (patients + appointments).
create or replace function public.search_global(p_query text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_patients jsonb;
  v_appointments jsonb;
  v_visits jsonb;
begin
  if length(btrim(coalesce(p_query, ''))) < 2 then
    return jsonb_build_object('patients', '[]'::jsonb, 'appointments', '[]'::jsonb, 'visits', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) - 'total' - 'rank'), '[]'::jsonb) into v_patients
    from public.search_patients(p_query, 8, 0) s;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_appointments from (
    select a.id, a.scheduled_at, a.status, a.visit_type, a.patient_id, p.full_name as patient_name,
           p.patient_code, d.display_name_en as doctor_name_en, coalesce(d.display_name_ar, d.display_name_en) as doctor_name_ar
      from public.appointments a
      join public.patients p on p.id = a.patient_id
      join public.doctors d on d.id = a.doctor_id
     where a.status in ('scheduled', 'checked_in', 'with_doctor')
       and a.scheduled_at >= now() - interval '1 day'
       and (p.full_name ilike '%' || p_query || '%' or p.patient_code ilike '%' || p_query || '%'
            or d.display_name_en ilike '%' || p_query || '%'
            or (length(regexp_replace(p_query, '\D', '', 'g')) >= 3
                and p.phone_normalized like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'))
     order by a.scheduled_at
     limit 6
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_visits from (
    select v.id, v.visit_type, v.status, v.visit_date, v.patient_id, p.full_name as patient_name, p.patient_code
      from public.visits v
      join public.patients p on p.id = v.patient_id
     where p.full_name ilike '%' || p_query || '%' or p.patient_code ilike '%' || p_query || '%'
     order by v.started_at desc
     limit 5
  ) x;

  return jsonb_build_object('patients', v_patients, 'appointments', v_appointments, 'visits', v_visits);
end;
$$;
