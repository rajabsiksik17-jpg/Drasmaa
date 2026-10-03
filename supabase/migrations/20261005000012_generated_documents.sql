-- =====================================================================
-- 0012 GENERATED DOCUMENTS: immutable PDF snapshots, document templates,
-- document access log, storage rules, doctor signatures.
-- =====================================================================

create table public.document_templates (
  document_type text primary key check (document_type in (
    'patient_summary', 'medical_history', 'visit_summary', 'gynecology_visit', 'pregnancy_summary',
    'pregnancy_followup', 'fertility_summary', 'oi_chart', 'investigations', 'appointment_summary',
    'timeline', 'ivf_consent')),
  name_en text not null,
  name_ar text not null,
  orientation text not null default 'portrait' check (orientation in ('portrait', 'landscape')),
  margin_top_mm integer not null default 12 check (margin_top_mm between 0 and 40),
  margin_right_mm integer not null default 10 check (margin_right_mm between 0 and 40),
  margin_bottom_mm integer not null default 14 check (margin_bottom_mm between 0 and 40),
  margin_left_mm integer not null default 10 check (margin_left_mm between 0 and 40),
  show_logo boolean not null default true,
  show_header boolean not null default true,
  show_patient_block boolean not null default true,
  show_footer boolean not null default true,
  footer_text_en text check (length(footer_text_en) <= 300),
  footer_text_ar text check (length(footer_text_ar) <= 300),
  show_doctor_info boolean not null default true,
  show_signature boolean not null default false,
  default_sections text[] not null default '{}'::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

insert into public.document_templates (document_type, name_en, name_ar, orientation, default_sections, show_signature) values
  ('patient_summary',    'Patient Summary',            'ملخص المريضة',            'portrait',
     array['patient', 'partner', 'medical_history', 'surgical_history', 'allergies', 'family_history',
           'medications', 'investigations', 'appointments'], true),
  ('medical_history',    'Medical History',            'التاريخ المرضي',          'portrait', '{}', false),
  ('visit_summary',      'Visit Summary',              'ملخص الزيارة',            'portrait', '{}', true),
  ('gynecology_visit',   'Gynecology Visit',           'زيارة نسائية',            'portrait', '{}', true),
  ('pregnancy_summary',  'Pregnancy Summary',          'ملخص الحمل',              'portrait', '{}', true),
  ('pregnancy_followup', 'Pregnancy Follow-up',        'متابعة الحمل',            'landscape', '{}', false),
  ('fertility_summary',  'Fertility Summary',          'ملخص الخصوبة',            'portrait', '{}', true),
  ('oi_chart',           'O/I Cycle Chart',            'مخطط تحريض الإباضة',      'landscape', '{}', false),
  ('investigations',     'Investigations',             'الفحوصات',                'portrait', '{}', false),
  ('appointment_summary','Appointment Summary',        'تفاصيل الموعد',           'portrait', '{}', false),
  ('timeline',           'Patient Timeline',           'السجل الزمني',            'portrait', '{}', false),
  ('ivf_consent',        'IVF Consent',                'موافقة الإخصاب',          'portrait', '{}', false)
on conflict (document_type) do nothing;

create table public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  document_type text not null references public.document_templates(document_type),
  title text not null check (length(title) <= 200),
  file_name text not null check (length(file_name) <= 200 and file_name !~ '[/\\:*?"<>|\r\n]'),
  storage_path text not null unique,
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  language text not null check (language in ('ar', 'en')),
  orientation text not null check (orientation in ('portrait', 'landscape')),
  version_no integer not null default 1,
  source_entity_type text check (source_entity_type in ('patient', 'visit', 'pregnancy_case', 'fertility_case', 'cycle', 'appointment', 'consent')),
  source_entity_id uuid,
  visit_id uuid references public.visits(id),
  pregnancy_case_id uuid references public.pregnancy_cases(id),
  fertility_case_id uuid references public.fertility_cases(id),
  cycle_id uuid references public.fertility_cycles(id),
  appointment_id uuid references public.appointments(id),
  options jsonb not null default '{}'::jsonb,   -- selected sections / codes only (no medical content)
  template_version integer,
  includes_signature boolean not null default false,
  status text not null default 'generated' check (status in ('generated', 'deleted', 'expired')),
  generated_by uuid not null default auth.uid() references public.profiles(id),
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  delete_reason text check (length(delete_reason) <= 300),
  constraint generated_documents_path check (storage_path like patient_id::text || '/generated/%')
);
create index generated_documents_patient_idx on public.generated_documents(patient_id, generated_at desc);
create index generated_documents_source_idx on public.generated_documents(source_entity_type, source_entity_id);
create index generated_documents_expiry_idx on public.generated_documents(expires_at) where status = 'generated' and expires_at is not null;

alter table public.communication_logs
  add constraint communication_logs_generated_document_fk
  foreign key (generated_document_id) references public.generated_documents(id);

-- Snapshot integrity: version numbering on insert; afterwards only the
-- delete/expiry status may change.
create or replace function public.tg_generated_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
begin
  if tg_op = 'INSERT' then
    new.status := 'generated';
    new.generated_at := now();
    new.version_no := coalesce((
      select max(g.version_no) from public.generated_documents g
       where g.patient_id = new.patient_id and g.document_type = new.document_type
         and g.source_entity_id is not distinct from new.source_entity_id), 0) + 1;
    select generated_document_retention_days into v_days from public.clinic_settings where id = 1;
    new.expires_at := case when v_days is not null then now() + make_interval(days => v_days) end;
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'deleted_at', 'deleted_by', 'delete_reason'])
     is distinct from (to_jsonb(old) - array['status', 'deleted_at', 'deleted_by', 'delete_reason']) then
    raise exception 'Generated documents are immutable snapshots.' using errcode = '42501';
  end if;
  if old.status <> 'generated' then
    raise exception 'This document was already removed.' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    if new.status <> 'deleted' or not public.has_permission('documents.delete') then
      raise exception 'You are not allowed to delete generated documents.' using errcode = '42501';
    end if;
    new.deleted_by := auth.uid();
  end if;
  new.deleted_at := coalesce(new.deleted_at, now());
  return new;
end;
$$;
create trigger generated_documents_guard before insert or update on public.generated_documents
  for each row execute function public.tg_generated_documents_guard();
create trigger generated_documents_audit after insert or update on public.generated_documents
  for each row execute function public.tg_audit('id');

create table public.document_access_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  generated_document_id uuid references public.generated_documents(id),
  document_id uuid references public.documents(id),
  patient_id uuid not null references public.patients(id),
  action text not null check (action in ('generated', 'previewed', 'viewed', 'downloaded', 'printed',
                                         'shared_native', 'whatsapp_prepared', 'whatsapp_opened',
                                         'email_sent', 'email_failed', 'deleted', 'expired')),
  channel text,
  recipient text check (length(recipient) <= 320),
  result text not null default 'ok' check (result in ('ok', 'failed')),
  actor_id uuid,
  constraint document_access_logs_target check (num_nonnulls(generated_document_id, document_id) = 1)
);
create index document_access_logs_doc_idx on public.document_access_logs(generated_document_id, occurred_at desc);
create index document_access_logs_patient_idx on public.document_access_logs(patient_id, occurred_at desc);
create trigger document_access_logs_immutable before update or delete on public.document_access_logs
  for each row execute function public.tg_audit_logs_immutable();

-- Logs an access by the current user to a document they can see.
create or replace function public.log_document_access(
  p_generated uuid, p_document uuid, p_action text, p_channel text default null,
  p_recipient text default null, p_result text default 'ok')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
begin
  if p_generated is not null then
    select patient_id into v_patient from public.generated_documents g
     where g.id = p_generated and public.can_access_patient(g.patient_id)
       and (public.has_permission('documents.view') or g.generated_by = auth.uid());
  else
    select patient_id into v_patient from public.documents d
     where d.id = p_document and public.can_access_patient(d.patient_id)
       and (public.has_permission('documents.view') or d.uploaded_by = auth.uid());
  end if;
  if v_patient is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  insert into public.document_access_logs (generated_document_id, document_id, patient_id, action, channel, recipient, result, actor_id)
  values (p_generated, case when p_generated is null then p_document end, v_patient, p_action,
          left(p_channel, 40), left(p_recipient, 320), coalesce(p_result, 'ok'), auth.uid());
end;
$$;
revoke execute on function public.log_document_access(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.log_document_access(uuid, uuid, text, text, text, text) to authenticated;

-- Expired exports: the worker removes the file; the medical record is untouched.
create or replace function public.expire_generated_documents(p_limit integer default 50)
returns table (id uuid, storage_path text)
language sql
security definer
set search_path = public
as $$
  with e as (
    select g.id from public.generated_documents g
     where g.status = 'generated' and g.expires_at is not null and g.expires_at < now()
     limit p_limit
     for update skip locked
  )
  update public.generated_documents g set status = 'expired'
    from e where g.id = e.id
  returning g.id, g.storage_path;
$$;
revoke execute on function public.expire_generated_documents(integer) from public, anon, authenticated;
grant execute on function public.expire_generated_documents(integer) to service_role;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.document_templates enable row level security;
create policy document_templates_read on public.document_templates for select to authenticated using (true);
create policy document_templates_update on public.document_templates for update to authenticated
  using (public.has_permission('templates.edit')) with check (public.has_permission('templates.edit'));
create trigger document_templates_touch before insert or update on public.document_templates
  for each row execute function public.tg_touch_row();
create trigger document_templates_audit after insert or update or delete on public.document_templates
  for each row execute function public.tg_audit('document_type');

alter table public.generated_documents enable row level security;
create policy generated_documents_select on public.generated_documents for select to authenticated
  using (public.can_access_patient(patient_id)
         and (public.has_permission('documents.view') or generated_by = auth.uid()));
create policy generated_documents_insert on public.generated_documents for insert to authenticated
  with check (public.has_permission('documents.generate') and public.can_access_patient(patient_id)
              and generated_by = auth.uid());
create policy generated_documents_update on public.generated_documents for update to authenticated
  using (public.has_permission('documents.delete') and public.can_access_patient(patient_id))
  with check (public.has_permission('documents.delete'));
revoke delete, truncate on public.generated_documents from anon, authenticated;

alter table public.document_access_logs enable row level security;
create policy document_access_logs_select on public.document_access_logs for select to authenticated
  using (public.has_permission('audit.view')
         or (public.has_permission('documents.view') and public.can_access_patient(patient_id)));
revoke insert, update, delete, truncate on public.document_access_logs from anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: generated PDFs live under <patient_id>/generated/<yyyy>/<mm>/<uuid>.pdf
-- (unpredictable object names; served only through the authorized download route).
-- ---------------------------------------------------------------------
drop policy if exists patient_documents_insert on storage.objects;
create policy patient_documents_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and public.can_access_patient(public.storage_path_patient(name))
    and (
      (public.has_permission('documents.upload') and split_part(name, '/', 2) <> 'generated')
      or (public.has_permission('documents.generate') and split_part(name, '/', 2) = 'generated'
          and name ~ '^[0-9a-f-]{36}/generated/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.pdf$')
    )
  );

drop policy if exists patient_documents_cleanup on storage.objects;
create policy patient_documents_cleanup on storage.objects for delete to authenticated
  using (
    bucket_id = 'patient-documents'
    and owner_id = auth.uid()::text
    and not exists (select 1 from public.documents d where d.storage_path = name)
    and not exists (select 1 from public.generated_documents g where g.storage_path = name)
  );

-- Private bucket for doctor signatures (read by the server only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-private', 'clinic-private', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false;

create policy clinic_private_write on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-private' and public.has_permission('settings.manage')
              and name ~ '^signatures/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$');

-- Realtime for the generated documents list.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'generated_documents') then
    alter publication supabase_realtime add table public.generated_documents;
  end if;
end;
$$;
