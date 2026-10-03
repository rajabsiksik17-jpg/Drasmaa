-- =====================================================================
-- 0007 STORAGE, REALTIME, SCHEDULER
-- =====================================================================

-- ---------------------------------------------------------------------
-- Storage: patient files live in a PRIVATE bucket under
--   <patient_id>/<uuid>.<ext>
-- and are only ever served through short-lived signed URLs.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-documents', 'patient-documents', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false;

-- Clinic branding (logo) is not patient data.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-assets', 'clinic-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create or replace function public.storage_path_patient(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

create policy patient_documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-documents'
    and public.can_access_patient(public.storage_path_patient(name))
    and (public.has_permission('documents.view') or owner_id = auth.uid()::text)
  );

create policy patient_documents_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and public.has_permission('documents.upload')
    and public.can_access_patient(public.storage_path_patient(name))
  );

-- Only orphaned objects (upload succeeded, record creation failed) can be
-- removed, and only by their uploader: registered documents are archived,
-- never deleted.
create policy patient_documents_cleanup on storage.objects for delete to authenticated
  using (
    bucket_id = 'patient-documents'
    and owner_id = auth.uid()::text
    and not exists (select 1 from public.documents d where d.storage_path = name)
  );

create policy clinic_assets_write on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-assets' and public.has_permission('settings.manage'));
create policy clinic_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'clinic-assets' and public.has_permission('settings.manage'));

-- ---------------------------------------------------------------------
-- Realtime: only the tables that drive live UI. Postgres-changes
-- delivery respects RLS, and clients subscribe with narrow filters.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'appointments', 'notifications', 'patients', 'patient_allergies', 'patient_husbands',
      'visits', 'fertility_cycles', 'fertility_cycle_days', 'fertility_cycle_medications',
      'fertility_cycle_hormones', 'fertility_cycle_follicles', 'fertility_cycle_endometrium',
      'pregnancy_followups', 'documents'
    ] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Scheduler: reminders are also processed by /api/cron/reminders, so the
-- system works whether or not pg_cron is available.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('appointment-reminders', '*/15 * * * *', 'select public.process_due_reminders()');
    exception when others then
      raise notice 'pg_cron not available (%). Use /api/cron/reminders instead.', sqlerrm;
    end;
  end if;
end;
$$;

-- The /api/cron/reminders route runs with the service role.
grant execute on function public.process_due_reminders() to service_role;
