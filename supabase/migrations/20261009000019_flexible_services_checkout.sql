-- =====================================================================
-- 0019 FLEXIBLE VISIT SERVICES, RECEPTION "PATIENT ENTERED", AUTO CHECKOUT
-- ---------------------------------------------------------------------
--  * Catalog = defaults; visit/invoice line = what was really charged.
--    Lines keep the catalog price (default_price) next to the actual
--    price, a per-line discount and notes. Custom lines (no catalog
--    service) are allowed. Price overrides need billing.price_override,
--    line discounts accounting.discount within the role limit. All line
--    changes are audited (tg_audit on invoice_lines).
--  * Reception can move a called patient to "with doctor" (patient entered).
--  * A finished visit whose patient part is fully paid is checked out
--    automatically (payment confirmed = completed); its appointment is
--    completed too. The visit leaves the live queue, never the history.
-- =====================================================================

insert into public.permissions (code, group_code, description_en, description_ar, sort_order) values
  ('billing.price_override', 'accounting', 'Change a service price for one visit / add custom services', 'تعديل سعر خدمة لزيارة / إضافة خدمات مخصصة', 128)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'billing.price_override' from public.roles r where r.code in ('admin', 'doctor')
on conflict do nothing;

alter table public.invoice_lines
  add column if not exists default_price numeric(12, 3) check (default_price >= 0),
  add column if not exists discount_amount numeric(12, 3) not null default 0 check (discount_amount >= 0),
  add column if not exists notes text check (length(notes) <= 500);
-- Existing catalog lines: the charged price was the catalog price.
update public.invoice_lines set default_price = unit_price where default_price is null and service_id is not null;

create or replace function public.tg_invoice_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  v_row public.invoice_lines := coalesce(new, old);
  v_internal boolean := coalesce(current_setting('app.internal_billing', true), '') = 'on';
  v_gross numeric;
  v_limit numeric;
begin
  select * into inv from public.invoices where id = v_row.invoice_id;
  if inv.status = 'void' then
    raise exception 'This invoice was voided.' using errcode = '42501';
  end if;
  if auth.uid() is not null and (inv.paid_patient + inv.paid_insurance) > 0 and not v_internal then
    if not public.has_permission('accounting.edit') then
      raise exception 'Paid invoices can only be corrected by authorized staff.' using errcode = '42501';
    end if;
    if public.request_audit_reason() is null then
      raise exception 'A reason is required to correct a paid invoice.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.package_line_id is not null then
    new.unit_price := 0;
    new.discount_amount := 0;
    new.line_total := 0;
    return new;
  end if;
  if length(btrim(coalesce(new.description_en, ''))) = 0 then
    raise exception 'Service name is required.' using errcode = 'P0001', hint = 'MISSING_FIELDS', detail = 'description';
  end if;

  if auth.uid() is not null and not v_internal then
    -- Price away from the catalog (or a custom line) = price override.
    if (tg_op = 'INSERT' and (new.service_id is null or new.unit_price is distinct from new.default_price))
       or (tg_op = 'UPDATE' and new.unit_price is distinct from old.unit_price) then
      if not (public.has_permission('billing.price_override') or public.has_permission('accounting.edit') or public.has_permission('pricing.manage')) then
        raise exception 'You are not allowed to change service prices.' using errcode = '42501';
      end if;
    end if;
    if new.discount_amount > 0 and (tg_op = 'INSERT' or new.discount_amount is distinct from old.discount_amount) then
      if not public.has_permission('accounting.discount') then
        raise exception 'You are not allowed to apply discounts.' using errcode = '42501';
      end if;
      select max_discount_percent into v_limit from public.roles where code = public.current_role_code();
      v_gross := public.money_round(new.unit_price * new.quantity);
      if v_limit is not null and v_gross > 0 and new.discount_amount * 100 / v_gross > v_limit + 0.0001 then
        raise exception 'The discount exceeds your limit (% %%).', v_limit
          using errcode = 'P0001', hint = 'DISCOUNT_LIMIT', detail = v_limit::text;
      end if;
    end if;
  end if;

  v_gross := public.money_round(new.unit_price * new.quantity);
  if new.discount_amount > v_gross then
    raise exception 'The discount is larger than the service amount.' using errcode = '23514';
  end if;
  new.line_total := v_gross - new.discount_amount;
  return new;
end;
$$;

-- Catalog default price snapshot on every catalog line.
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
  v_price numeric;
  item record;
begin
  select * into inv from public.invoices where id = p_invoice;
  select * into s from public.services where id = p_service;
  if inv.id is null or s.id is null then
    raise exception 'Invoice or service not found.' using errcode = 'P0002';
  end if;
  v_price := case when s.billable then coalesce(public.service_price_for(s.id, inv.payment_type, inv.insurance_company_id, inv.doctor_id), 0) else 0 end;
  insert into public.invoice_lines (invoice_id, service_id, description_en, description_ar, quantity, unit_price, default_price, source, sort_order)
  values (p_invoice, s.id, s.name_en, s.name_ar, p_quantity, v_price, v_price,
          case when s.category = 'package' then 'package' else p_source end,
          (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = p_invoice))
  returning id into v_line;
  if s.category = 'package' then
    for item in select pi.quantity, c.* from public.service_package_items pi join public.services c on c.id = pi.service_id where pi.package_id = s.id loop
      insert into public.invoice_lines (invoice_id, service_id, description_en, description_ar, quantity, unit_price, default_price, package_line_id, source, sort_order)
      values (p_invoice, item.id, item.name_en, item.name_ar, item.quantity * p_quantity, 0, 0, v_line, 'package',
              (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = p_invoice));
    end loop;
  end if;
  return v_line;
end;
$$;

-- Reception may confirm "patient entered" for a patient the doctor called.
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
        if not (public.has_permission('visits.create') or (e.status = 'called' and public.has_permission('encounters.create'))) then
          raise exception 'Not allowed.' using errcode = '42501';
        end if;
      else
        if not (public.has_permission('accounting.create') or public.has_permission('encounters.create')) then
          raise exception 'Not allowed.' using errcode = '42501';
        end if;
        if e.prepay and not public.encounter_bill_settled(e.id) and v_reason is null then
          raise exception 'The bill is not paid yet. A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
        end if;
      end if;
    when 'with_doctor' then
      if not (public.has_permission('visits.create')
              or (e.status = 'called' and (public.has_permission('encounters.create') or public.has_permission('appointments.checkin')))) then
        raise exception 'Not allowed.' using errcode = '42501';
      end if;
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
end;
$$;

-- Finished + fully paid = checked out (payment confirmed). Checked out =
-- the appointment, if any, is completed. Runs inside the same transaction
-- as the payment, so it only happens when the payment really succeeded.
create or replace function public.tg_encounters_autoclose()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt text;
begin
  if new.status = 'awaiting_checkout' and old.status is distinct from 'awaiting_checkout'
     and public.encounter_bill_settled(new.id) then
    update public.encounters set status = 'checked_out' where id = new.id and status = 'awaiting_checkout';
  elsif new.status = 'checked_out' and old.status is distinct from 'checked_out' and new.appointment_id is not null then
    select status into v_appt from public.appointments where id = new.appointment_id;
    if v_appt = 'checked_in' then
      update public.appointments set status = 'with_doctor' where id = new.appointment_id;
      v_appt := 'with_doctor';
    end if;
    if v_appt = 'with_doctor' then
      update public.appointments set status = 'completed' where id = new.appointment_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists encounters_autoclose on public.encounters;
create trigger encounters_autoclose after update of status on public.encounters
  for each row execute function public.tg_encounters_autoclose();

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
    -- Payment confirmed after the doctor finished: the visit is completed.
    update public.encounters set status = 'checked_out'
     where id = new.encounter_id and status = 'awaiting_checkout';
  end if;
  return new;
end;
$$;
