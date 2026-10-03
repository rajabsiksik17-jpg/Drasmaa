-- =====================================================================
-- 0014 CENTER INFORMATION, DOCUMENT NUMBERING, SERVICES & PRICES,
--      ACCOUNTING (invoices, payments, refunds, insurance, cash register)
-- =====================================================================
-- Money: numeric(12,3) (JOD has 3 decimals). Historical prices are never
-- recalculated: invoice lines store the charged price as a snapshot.
-- Payments are append-only; corrections are refunds / adjustments with a
-- reason; a closed cash register cannot change (adjustments only).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.permissions (code, group_code, description_en, description_ar, sort_order) values
  ('accounting.view',      'accounting', 'View accounting, invoices and payments',      'عرض المحاسبة والفواتير والدفعات', 130),
  ('accounting.create',    'accounting', 'Create invoices and record payments',          'إنشاء الفواتير وتسجيل الدفعات', 131),
  ('accounting.edit',      'accounting', 'Correct invoices (with reason)',               'تصحيح الفواتير (مع السبب)', 132),
  ('accounting.refund',    'accounting', 'Refund payments',                              'استرداد الدفعات', 133),
  ('accounting.discount',  'accounting', 'Apply discounts',                              'تطبيق الخصومات', 134),
  ('accounting.close_day', 'accounting', 'Open / close the daily cash register',         'فتح / إغلاق الصندوق اليومي', 135),
  ('pricing.view',         'accounting', 'See services and prices',                      'عرض الخدمات والأسعار', 136),
  ('pricing.manage',       'accounting', 'Manage services, prices and packages',         'إدارة الخدمات والأسعار والباقات', 137),
  ('reports.view',         'reports',    'View medical reports',                         'عرض التقارير الطبية', 140),
  ('reports.create',       'reports',    'Create medical reports',                       'إنشاء التقارير الطبية', 141),
  ('reports.edit',         'reports',    'Edit medical reports and report templates',    'تعديل التقارير الطبية وقوالبها', 142),
  ('reports.delete',       'reports',    'Void medical reports',                         'إلغاء التقارير الطبية', 143),
  ('prescriptions.view',   'clinical',   'View prescriptions',                           'عرض الوصفات الطبية', 25),
  ('prescriptions.create', 'clinical',   'Write prescriptions',                          'كتابة الوصفات الطبية', 26),
  ('prescriptions.edit',   'clinical',   'Edit / cancel prescriptions',                  'تعديل / إلغاء الوصفات الطبية', 27),
  ('medications.manage',   'clinical',   'Manage the medication catalog',                'إدارة قائمة الأدوية', 28),
  ('drawings.view',        'clinical',   'View ultrasound images and drawings',          'عرض صور السونار والرسومات', 62),
  ('drawings.create',      'clinical',   'Add ultrasound images and drawings',           'إضافة صور السونار والرسومات', 63),
  ('drawings.edit',        'clinical',   'Edit drawings',                                'تعديل الرسومات', 64)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p where r.code = 'admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r
join public.permissions p on p.code in (
  'reports.view', 'reports.create', 'reports.edit', 'prescriptions.view', 'prescriptions.create', 'prescriptions.edit',
  'medications.manage', 'drawings.view', 'drawings.create', 'drawings.edit', 'pricing.view')
where r.code = 'doctor'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r
join public.permissions p on p.code in ('accounting.view', 'accounting.create', 'accounting.close_day', 'pricing.view')
where r.code = 'receptionist'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Center information (single source of truth for every document)
-- ---------------------------------------------------------------------
alter table public.clinic_settings
  add column if not exists mobile text,
  add column if not exists whatsapp text,
  add column if not exists website text check (website is null or website ~* '^https?://'),
  add column if not exists city_en text,
  add column if not exists city_ar text,
  add column if not exists country_en text,
  add column if not exists country_ar text,
  add column if not exists location_text text,
  add column if not exists maps_url text check (maps_url is null or maps_url ~* '^https://'),
  add column if not exists license_text text,
  add column if not exists secondary_logo_path text,
  add column if not exists main_doctor_id uuid references public.doctors(id),
  add column if not exists header_text_en text,
  add column if not exists header_text_ar text,
  add column if not exists footer_text_en text,
  add column if not exists footer_text_ar text,
  add column if not exists report_footer_en text,
  add column if not exists report_footer_ar text,
  add column if not exists prescription_footer_en text,
  add column if not exists prescription_footer_ar text,
  add column if not exists invoice_footer_en text,
  add column if not exists invoice_footer_ar text,
  add column if not exists receipt_footer_en text,
  add column if not exists receipt_footer_ar text,
  add column if not exists currency text not null default 'JOD' check (currency ~ '^[A-Z]{3}$'),
  add column if not exists currency_decimals integer not null default 3 check (currency_decimals between 0 and 3),
  add column if not exists invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z]{1,6}$'),
  add column if not exists receipt_prefix text not null default 'RCT' check (receipt_prefix ~ '^[A-Z]{1,6}$'),
  add column if not exists report_prefix text not null default 'MED' check (report_prefix ~ '^[A-Z]{1,6}$'),
  add column if not exists prescription_prefix text not null default 'RX' check (prescription_prefix ~ '^[A-Z]{1,6}$');

alter table public.insurance_companies
  add column if not exists default_coverage_percent numeric(5, 2) check (default_coverage_percent between 0 and 100);

-- Unique, never reused numbers: PREFIX-YYYY-000001
create table public.document_sequences (
  kind text not null check (kind in ('invoice', 'receipt', 'report', 'prescription')),
  year integer not null,
  last_value integer not null default 0,
  primary key (kind, year)
);
alter table public.document_sequences enable row level security;
revoke all on public.document_sequences from anon, authenticated;

create or replace function public.next_document_number(p_kind text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from (now() at time zone public.clinic_timezone()))::integer;
  v_value integer;
  v_prefix text;
begin
  insert into public.document_sequences as s (kind, year, last_value) values (p_kind, v_year, 1)
  on conflict (kind, year) do update set last_value = s.last_value + 1
  returning last_value into v_value;
  select case p_kind when 'invoice' then invoice_prefix when 'receipt' then receipt_prefix
                     when 'report' then report_prefix else prescription_prefix end
    into v_prefix from public.clinic_settings where id = 1;
  return coalesce(v_prefix, upper(left(p_kind, 3))) || '-' || v_year || '-' || lpad(v_value::text, 6, '0');
end;
$$;
revoke execute on function public.next_document_number(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Services & prices
-- ---------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text unique check (code ~ '^[a-z][a-z0-9_]*$'),
  category text not null default 'other' check (category in (
    'consultation', 'followup', 'ultrasound', 'investigation', 'report', 'certificate', 'procedure', 'treatment', 'package', 'other')),
  name_en text not null check (length(btrim(name_en)) between 1 and 160),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 160),
  price_cash numeric(12, 3) not null default 0 check (price_cash >= 0),
  price_insurance numeric(12, 3) check (price_insurance >= 0),
  billable boolean not null default true,
  insurance_eligible boolean not null default true,
  default_duration_minutes integer check (default_duration_minutes between 5 and 480),
  -- Appointment type this service is the default for (dropdown_options.appointment_type).
  appointment_type text,
  -- Automatic charge triggers: an ultrasound in the visit, a medical report, ...
  auto_trigger text check (auto_trigger in ('ultrasound', 'medical_report', 'medical_certificate')),
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create unique index services_appointment_type_idx on public.services(appointment_type) where appointment_type is not null and active;
create unique index services_auto_trigger_idx on public.services(auto_trigger) where auto_trigger is not null and active;

-- Insurance-company specific prices.
create table public.service_insurance_prices (
  service_id uuid not null references public.services(id) on delete cascade,
  insurance_company_id uuid not null references public.insurance_companies(id) on delete cascade,
  price numeric(12, 3) not null check (price >= 0),
  coverage_percent numeric(5, 2) check (coverage_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (service_id, insurance_company_id)
);

-- Package components (a package is a service with category 'package').
create table public.service_package_items (
  package_id uuid not null references public.services(id) on delete cascade,
  service_id uuid not null references public.services(id),
  quantity integer not null default 1 check (quantity between 1 and 50),
  primary key (package_id, service_id),
  check (package_id <> service_id)
);

-- Price history (append-only): every change of a price is kept.
create table public.service_price_history (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.services(id) on delete cascade,
  price_cash numeric(12, 3),
  price_insurance numeric(12, 3),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create or replace function public.tg_services_price_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or (new.price_cash, new.price_insurance) is distinct from (old.price_cash, old.price_insurance) then
    insert into public.service_price_history (service_id, price_cash, price_insurance, changed_by)
    values (new.id, new.price_cash, new.price_insurance, auth.uid());
  end if;
  return new;
end;
$$;
create trigger services_price_history after insert or update on public.services
  for each row execute function public.tg_services_price_history();
create trigger service_price_history_immutable before update or delete on public.service_price_history
  for each row execute function public.tg_audit_logs_immutable();

insert into public.services (code, category, name_en, name_ar, price_cash, price_insurance, appointment_type, auto_trigger, default_duration_minutes, sort_order) values
  ('consultation',           'consultation', 'Consultation',              'استشارة',              20, 15, 'consultation', null, 15, 1),
  ('followup',               'followup',     'Follow-up consultation',    'استشارة متابعة',       15, 12, null,           null, 15, 2),
  ('fertility_consultation', 'consultation', 'Fertility consultation',    'استشارة خصوبة',        25, 20, 'fertility',    null, 20, 3),
  ('pregnancy_consultation', 'consultation', 'Pregnancy consultation',    'استشارة حمل',          20, 15, 'pregnancy',    null, 15, 4),
  ('gynecology_consultation','consultation', 'Gynecology consultation',   'استشارة نسائية',       20, 15, 'gynecology',   null, 15, 5),
  ('oi_followup',            'followup',     'O/I follow-up',             'متابعة تحريض الإباضة', 15, 12, 'oi_followup',  null, 15, 6),
  ('ultrasound',             'ultrasound',   'Ultrasound',                'تصوير بالأمواج فوق الصوتية', 25, 20, null,      'ultrasound', 15, 7),
  ('medical_report',         'report',       'Medical report',            'تقرير طبي',            15, 10, null,           'medical_report', null, 8),
  ('medical_certificate',    'certificate',  'Medical certificate',       'شهادة طبية',           10, null, null,         'medical_certificate', null, 9)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Appointments ↔ service
-- ---------------------------------------------------------------------
alter table public.appointments
  add column if not exists service_id uuid references public.services(id),
  add column if not exists no_charge boolean not null default false;

-- ---------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  patient_id uuid not null references public.patients(id),
  appointment_id uuid references public.appointments(id),
  visit_id uuid references public.visits(id),
  doctor_id uuid references public.doctors(id),
  status text not null default 'open' check (status in ('open', 'partially_paid', 'paid', 'no_charge', 'void')),
  payment_type text not null default 'cash' check (payment_type in ('cash', 'insurance', 'mixed')),
  insurance_company_id uuid references public.insurance_companies(id),
  insurance_claim_ref text check (length(insurance_claim_ref) <= 80),
  currency text not null default 'JOD',
  subtotal numeric(12, 3) not null default 0,
  discount_type text check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12, 3) not null default 0 check (discount_value >= 0),
  discount_amount numeric(12, 3) not null default 0,
  discount_reason text check (length(discount_reason) <= 300),
  total numeric(12, 3) not null default 0,
  insurance_amount numeric(12, 3) not null default 0 check (insurance_amount >= 0),
  patient_amount numeric(12, 3) not null default 0,
  paid_patient numeric(12, 3) not null default 0,
  paid_insurance numeric(12, 3) not null default 0,
  balance_patient numeric(12, 3) not null default 0,
  balance_insurance numeric(12, 3) not null default 0,
  refunded_total numeric(12, 3) not null default 0,
  notes text check (length(notes) <= 2000),
  issued_at timestamptz not null default now(),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1,
  constraint invoices_insurance_company check (payment_type = 'cash' or insurance_company_id is not null),
  constraint invoices_discount_percent check (discount_type <> 'percent' or discount_value <= 100)
);
create index invoices_patient_idx on public.invoices(patient_id, issued_at desc);
create index invoices_issued_idx on public.invoices(issued_at desc);
create index invoices_status_idx on public.invoices(status);
create index invoices_insurance_idx on public.invoices(insurance_company_id) where balance_insurance > 0;
create unique index invoices_appointment_idx on public.invoices(appointment_id) where appointment_id is not null and status <> 'void';
create unique index invoices_visit_idx on public.invoices(visit_id) where visit_id is not null and status <> 'void';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  service_id uuid references public.services(id),
  -- Snapshot: what was charged, independent of later catalog changes.
  description_en text not null,
  description_ar text not null,
  quantity integer not null default 1 check (quantity between 1 and 100),
  unit_price numeric(12, 3) not null check (unit_price >= 0),
  line_total numeric(12, 3) not null default 0,
  -- Package components are listed for transparency with price 0.
  package_line_id uuid references public.invoice_lines(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'appointment', 'ultrasound', 'medical_report', 'medical_certificate', 'package')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id, sort_order);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  invoice_id uuid not null references public.invoices(id),
  patient_id uuid not null references public.patients(id),
  kind text not null default 'payment' check (kind in ('payment', 'refund')),
  payer text not null check (payer in ('patient', 'insurance')),
  method text not null check (method in ('cash', 'card', 'transfer', 'insurance', 'other')),
  amount numeric(12, 3) not null check (amount > 0),
  reference text check (length(reference) <= 120),
  reason text check (length(reason) <= 300),
  refund_of_id uuid references public.payments(id),
  register_date date not null default ((now() at time zone 'Asia/Amman')::date),
  received_at timestamptz not null default now(),
  received_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint payments_refund_link check ((kind = 'refund') = (refund_of_id is not null)),
  constraint payments_refund_reason check (kind = 'payment' or length(btrim(coalesce(reason, ''))) >= 3),
  constraint payments_insurance_method check ((payer = 'insurance') = (method = 'insurance') or method = 'transfer')
);
create index payments_invoice_idx on public.payments(invoice_id, received_at);
create index payments_patient_idx on public.payments(patient_id, received_at desc);
create index payments_register_idx on public.payments(register_date, method);

-- ---------------------------------------------------------------------
-- Daily cash register
-- ---------------------------------------------------------------------
create table public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  register_date date not null unique,
  opening_balance numeric(12, 3) not null default 0 check (opening_balance >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  cash_received numeric(12, 3),
  cash_refunds numeric(12, 3),
  cash_expenses numeric(12, 3),
  expected_cash numeric(12, 3),
  actual_cash numeric(12, 3) check (actual_cash >= 0),
  difference numeric(12, 3),
  notes text check (length(notes) <= 1000),
  opened_by uuid default auth.uid(),
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version integer not null default 1
);

create table public.cash_expenses (
  id uuid primary key default gen_random_uuid(),
  register_date date not null,
  amount numeric(12, 3) not null check (amount > 0),
  description text not null check (length(btrim(description)) between 2 and 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index cash_expenses_date_idx on public.cash_expenses(register_date);

-- Corrections after closing: auditable, never an edit of the closed day.
create table public.cash_register_adjustments (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.cash_registers(id),
  amount numeric(12, 3) not null check (amount <> 0),
  reason text not null check (length(btrim(reason)) >= 3),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Accounting engine
-- ---------------------------------------------------------------------
create or replace function public.money_round(p numeric)
returns numeric
language sql
immutable
as $$ select round(coalesce(p, 0), 3) $$;

-- Recomputes every derived amount of an invoice (single place of truth).
create or replace function public.recalc_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  v_subtotal numeric;
  v_discount numeric;
  v_total numeric;
  v_ins numeric;
  v_paid_patient numeric;
  v_paid_ins numeric;
  v_refunds numeric;
  v_status text;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then return; end if;
  select coalesce(sum(line_total), 0) into v_subtotal from public.invoice_lines where invoice_id = p_invoice and package_line_id is null;
  v_discount := case inv.discount_type
                  when 'percent' then public.money_round(v_subtotal * inv.discount_value / 100)
                  when 'fixed' then least(inv.discount_value, v_subtotal)
                  else 0 end;
  v_total := v_subtotal - v_discount;
  v_ins := case when inv.payment_type = 'cash' then 0 else least(inv.insurance_amount, v_total) end;
  select coalesce(sum(case when kind = 'payment' then amount else -amount end) filter (where payer = 'patient'), 0),
         coalesce(sum(case when kind = 'payment' then amount else -amount end) filter (where payer = 'insurance'), 0),
         coalesce(sum(amount) filter (where kind = 'refund'), 0)
    into v_paid_patient, v_paid_ins, v_refunds
    from public.payments where invoice_id = p_invoice;
  v_status := case
    when inv.status = 'void' then 'void'
    when v_total = 0 and exists (select 1 from public.invoice_lines where invoice_id = p_invoice) then 'no_charge'
    when v_total > 0 and v_paid_patient >= v_total - v_ins and v_paid_ins >= v_ins then 'paid'
    when v_paid_patient > 0 or v_paid_ins > 0 then 'partially_paid'
    else 'open' end;
  update public.invoices set
    subtotal = v_subtotal, discount_amount = v_discount, total = v_total,
    insurance_amount = v_ins, patient_amount = v_total - v_ins,
    paid_patient = v_paid_patient, paid_insurance = v_paid_ins,
    balance_patient = (v_total - v_ins) - v_paid_patient, balance_insurance = v_ins - v_paid_ins,
    refunded_total = v_refunds, status = v_status
  where id = p_invoice
    and (subtotal, discount_amount, total, insurance_amount, patient_amount, paid_patient, paid_insurance,
         balance_patient, balance_insurance, refunded_total, status)
        is distinct from
        (v_subtotal, v_discount, v_total, v_ins, v_total - v_ins, v_paid_patient, v_paid_ins,
         (v_total - v_ins) - v_paid_patient, v_ins - v_paid_ins, v_refunds, v_status);
end;
$$;

-- Invoice guard: numbering, discount permission, corrections need a reason.
create or replace function public.tg_invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_payments boolean;
begin
  if tg_op = 'INSERT' then
    new.invoice_number := public.next_document_number('invoice');
    new.currency := coalesce((select currency from public.clinic_settings where id = 1), 'JOD');
    if new.discount_value > 0 and auth.uid() is not null and not public.has_permission('accounting.discount') then
      raise exception 'You are not allowed to apply discounts.' using errcode = '42501';
    end if;
    return new;
  end if;
  if pg_trigger_depth() > 1 then
    return new;   -- derived amounts written by recalc_invoice()
  end if;
  if new.invoice_number is distinct from old.invoice_number or new.patient_id is distinct from old.patient_id then
    raise exception 'Invoice number and patient cannot change.' using errcode = '42501';
  end if;
  if old.status = 'void' then
    raise exception 'This invoice was voided.' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    if (new.discount_type, new.discount_value) is distinct from (old.discount_type, old.discount_value)
       and not public.has_permission('accounting.discount') then
      raise exception 'You are not allowed to apply discounts.' using errcode = '42501';
    end if;
    v_has_payments := exists (select 1 from public.payments where invoice_id = old.id);
    if new.status = 'void' then
      if not public.has_permission('accounting.edit') then
        raise exception 'You are not allowed to void invoices.' using errcode = '42501';
      end if;
      if old.paid_patient + old.paid_insurance > 0 then
        raise exception 'Refund the payments before voiding the invoice.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
      end if;
      if public.request_audit_reason() is null then
        raise exception 'A reason is required.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
      new.void_reason := public.request_audit_reason();
    elsif v_has_payments and (new.discount_type, new.discount_value, new.payment_type, new.insurance_amount, new.insurance_company_id)
          is distinct from (old.discount_type, old.discount_value, old.payment_type, old.insurance_amount, old.insurance_company_id) then
      if not public.has_permission('accounting.edit') then
        raise exception 'Paid invoices can only be corrected by authorized staff.' using errcode = '42501';
      end if;
      if public.request_audit_reason() is null then
        raise exception 'A reason is required to correct a paid invoice.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
      end if;
    end if;
    -- Derived amounts are never set by clients.
    new.subtotal := old.subtotal; new.discount_amount := old.discount_amount; new.total := old.total;
    new.patient_amount := old.patient_amount; new.paid_patient := old.paid_patient; new.paid_insurance := old.paid_insurance;
    new.balance_patient := old.balance_patient; new.balance_insurance := old.balance_insurance;
    new.refunded_total := old.refunded_total;
    if new.status <> 'void' then new.status := old.status; end if;
  end if;
  return new;
end;
$$;
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function public.tg_invoices_guard();

create or replace function public.tg_invoices_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() = 1 then
    perform public.recalc_invoice(new.id);
  end if;
  return new;
end;
$$;
create trigger invoices_after after insert or update on public.invoices
  for each row execute function public.tg_invoices_after();

create or replace function public.tg_invoice_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  v_row public.invoice_lines := coalesce(new, old);
begin
  select * into inv from public.invoices where id = v_row.invoice_id;
  if inv.status = 'void' then
    raise exception 'This invoice was voided.' using errcode = '42501';
  end if;
  if auth.uid() is not null and (inv.paid_patient + inv.paid_insurance) > 0 then
    if not public.has_permission('accounting.edit') then
      raise exception 'Paid invoices can only be corrected by authorized staff.' using errcode = '42501';
    end if;
    if public.request_audit_reason() is null then
      raise exception 'A reason is required to correct a paid invoice.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    new.line_total := case when new.package_line_id is null then public.money_round(new.unit_price * new.quantity) else 0 end;
    if new.package_line_id is not null then new.unit_price := 0; end if;
    return new;
  end if;
  return old;
end;
$$;
create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function public.tg_invoice_lines_guard();

create or replace function public.tg_invoice_lines_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;
create trigger invoice_lines_after after insert or update or delete on public.invoice_lines
  for each row execute function public.tg_invoice_lines_after();

-- Payments: numbering, refunds limits, closed register protection.
create or replace function public.tg_payments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  orig public.payments;
  v_refunded numeric;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Payments are permanent. Use a refund to correct them.' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = new.invoice_id;
  if not found or inv.status = 'void' then
    raise exception 'Invoice not available.' using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;
  new.patient_id := inv.patient_id;
  new.receipt_number := public.next_document_number('receipt');
  new.register_date := (coalesce(new.received_at, now()) at time zone public.clinic_timezone())::date;
  if new.method = 'cash' and exists (select 1 from public.cash_registers r where r.register_date = new.register_date and r.status = 'closed') then
    raise exception 'The cash register for this day is closed.' using errcode = 'P0001', hint = 'REGISTER_CLOSED';
  end if;
  if new.kind = 'refund' then
    if auth.uid() is not null and not public.has_permission('accounting.refund') then
      raise exception 'You are not allowed to refund payments.' using errcode = '42501';
    end if;
    select * into orig from public.payments where id = new.refund_of_id;
    if not found or orig.kind <> 'payment' or orig.invoice_id <> new.invoice_id then
      raise exception 'Original payment not found.' using errcode = 'P0002';
    end if;
    select coalesce(sum(amount), 0) into v_refunded from public.payments where refund_of_id = orig.id;
    if new.amount > orig.amount - v_refunded then
      raise exception 'Refund exceeds the refundable amount.' using errcode = '23514';
    end if;
    new.payer := orig.payer;
  else
    if new.payer = 'patient' and new.amount > inv.balance_patient + 0.0005 then
      raise exception 'Payment exceeds the patient balance.' using errcode = '23514';
    end if;
    if new.payer = 'insurance' and new.amount > inv.balance_insurance + 0.0005 then
      raise exception 'Payment exceeds the insurance balance.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger payments_guard before insert or update or delete on public.payments
  for each row execute function public.tg_payments_guard();

create or replace function public.tg_payments_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_invoice(new.invoice_id);
  return new;
end;
$$;
create trigger payments_after after insert on public.payments
  for each row execute function public.tg_payments_after();

create or replace function public.tg_cash_registers_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_received numeric;
  v_refunds numeric;
  v_expenses numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'Cash registers cannot be deleted.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' then
    raise exception 'This cash register is closed. Add an adjustment instead.' using errcode = '42501';
  end if;
  if new.status = 'closed' then
    if new.actual_cash is null then
      raise exception 'Enter the counted cash to close the register.' using errcode = '23514';
    end if;
    select coalesce(sum(amount) filter (where kind = 'payment'), 0), coalesce(sum(amount) filter (where kind = 'refund'), 0)
      into v_received, v_refunds
      from public.payments where register_date = new.register_date and method = 'cash';
    select coalesce(sum(amount), 0) into v_expenses from public.cash_expenses where register_date = new.register_date;
    new.cash_received := v_received;
    new.cash_refunds := v_refunds;
    new.cash_expenses := v_expenses;
    new.expected_cash := new.opening_balance + v_received - v_refunds - v_expenses;
    new.difference := new.actual_cash - new.expected_cash;
    new.closed_at := now();
    new.closed_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger cash_registers_guard before insert or update or delete on public.cash_registers
  for each row execute function public.tg_cash_registers_guard();

create or replace function public.tg_cash_expenses_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Expenses are permanent. Add an adjustment instead.' using errcode = '42501';
  end if;
  if exists (select 1 from public.cash_registers where register_date = new.register_date and status = 'closed') then
    raise exception 'The cash register for this day is closed.' using errcode = 'P0001', hint = 'REGISTER_CLOSED';
  end if;
  return new;
end;
$$;
create trigger cash_expenses_guard before insert or update or delete on public.cash_expenses
  for each row execute function public.tg_cash_expenses_guard();
create trigger cash_register_adjustments_immutable before update or delete on public.cash_register_adjustments
  for each row execute function public.tg_audit_logs_immutable();

-- ---------------------------------------------------------------------
-- Automatic billing (derived from clinical actions)
-- ---------------------------------------------------------------------
-- Price for a service given the invoice payment type / insurance company.
create or replace function public.service_price(p_service uuid, p_payment_type text, p_insurance uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_payment_type <> 'cash' and s.insurance_eligible then
      coalesce((select sip.price from public.service_insurance_prices sip
                 where sip.service_id = s.id and sip.insurance_company_id = p_insurance),
               s.price_insurance, s.price_cash)
    else s.price_cash end
  from public.services s where s.id = p_service;
$$;

-- Adds a service (expanding packages) to an invoice with snapshot prices.
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
  item record;
begin
  select * into inv from public.invoices where id = p_invoice;
  select * into s from public.services where id = p_service;
  if inv.id is null or s.id is null then
    raise exception 'Invoice or service not found.' using errcode = 'P0002';
  end if;
  insert into public.invoice_lines (invoice_id, service_id, description_en, description_ar, quantity, unit_price, source, sort_order)
  values (p_invoice, s.id, s.name_en, s.name_ar, p_quantity,
          case when s.billable then coalesce(public.service_price(s.id, inv.payment_type, inv.insurance_company_id), 0) else 0 end,
          case when s.category = 'package' then 'package' else p_source end,
          (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = p_invoice))
  returning id into v_line;
  if s.category = 'package' then
    for item in select pi.quantity, c.* from public.service_package_items pi join public.services c on c.id = pi.service_id where pi.package_id = s.id loop
      insert into public.invoice_lines (invoice_id, service_id, description_en, description_ar, quantity, unit_price, package_line_id, source, sort_order)
      values (p_invoice, item.id, item.name_en, item.name_ar, item.quantity * p_quantity, 0, v_line, 'package',
              (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = p_invoice));
    end loop;
  end if;
  return v_line;
end;
$$;

-- Public entry point (permission + patient access checked).
create or replace function public.add_invoice_service(p_invoice uuid, p_service uuid, p_quantity integer default 1)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
begin
  select patient_id into v_patient from public.invoices where id = p_invoice;
  if v_patient is null or not public.has_permission('accounting.create') or not public.can_access_patient(v_patient) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.invoice_add_service_internal(p_invoice, p_service, greatest(1, least(coalesce(p_quantity, 1), 100)), 'manual');
end;
$$;

-- The invoice of an appointment (created on first need, with the appointment's service).
create or replace function public.appointment_invoice_internal(p_appointment uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.appointments;
  p public.patients;
  v_invoice uuid;
  v_service uuid;
begin
  select * into a from public.appointments where id = p_appointment;
  if not found then
    raise exception 'Appointment not found.' using errcode = 'P0002';
  end if;
  select id into v_invoice from public.invoices where appointment_id = a.id and status <> 'void';
  if v_invoice is not null then return v_invoice; end if;
  select * into p from public.patients where id = a.patient_id;
  insert into public.invoices (patient_id, appointment_id, doctor_id, payment_type, insurance_company_id, insurance_amount)
  values (a.patient_id, a.id, a.doctor_id,
          case when coalesce(a.payment_method, p.payment_method) = 'insurance' then 'insurance' else 'cash' end,
          case when coalesce(a.payment_method, p.payment_method) = 'insurance' then coalesce(a.insurance_company_id, p.insurance_company_id) end,
          0)
  returning id into v_invoice;
  if not a.no_charge then
    v_service := coalesce(a.service_id, (select id from public.services where appointment_type = a.visit_type and active));
    if v_service is not null then
      perform public.invoice_add_service_internal(v_invoice, v_service, 1, 'appointment');
    end if;
  end if;
  perform public.apply_default_coverage(v_invoice);
  return v_invoice;
end;
$$;

create or replace function public.ensure_appointment_invoice(p_appointment uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
begin
  select patient_id into v_patient from public.appointments where id = p_appointment;
  if v_patient is null or not public.has_permission('accounting.create') or not public.can_access_patient(v_patient) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.appointment_invoice_internal(p_appointment);
end;
$$;

-- Insurance share defaults to the company coverage percentage.
create or replace function public.apply_default_coverage(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices;
  v_pct numeric;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.payment_type = 'cash' or inv.paid_insurance > 0 then return; end if;
  select default_coverage_percent into v_pct from public.insurance_companies where id = inv.insurance_company_id;
  update public.invoices set insurance_amount = public.money_round(inv.total * coalesce(v_pct, 100) / 100) where id = p_invoice;
end;
$$;

-- Adds an automatic charge (ultrasound, report, ...) once per invoice.
create or replace function public.auto_charge(p_invoice uuid, p_trigger text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service uuid;
begin
  select id into v_service from public.services where auto_trigger = p_trigger and active and billable;
  if v_service is null or p_invoice is null then return; end if;
  if exists (select 1 from public.invoice_lines where invoice_id = p_invoice and source = p_trigger) then return; end if;
  if exists (select 1 from public.invoices where id = p_invoice and (status = 'void' or paid_patient + paid_insurance > 0)) then return; end if;
  perform public.invoice_add_service_internal(p_invoice, v_service, 1, p_trigger);
  perform public.apply_default_coverage(p_invoice);
end;
$$;

-- Completing a visit prepares its invoice (consultation + ultrasound if any).
create or replace function public.tg_visits_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid;
  p public.patients;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.appointment_id is not null then
      v_invoice := public.appointment_invoice_internal(new.appointment_id);
      update public.invoices set visit_id = new.id where id = v_invoice and visit_id is null;
    else
      select id into v_invoice from public.invoices where visit_id = new.id and status <> 'void';
      if v_invoice is null then
        select * into p from public.patients where id = new.patient_id;
        insert into public.invoices (patient_id, visit_id, doctor_id, payment_type, insurance_company_id)
        values (new.patient_id, new.id, new.doctor_id,
                case when p.payment_method = 'insurance' then 'insurance' else 'cash' end,
                case when p.payment_method = 'insurance' then p.insurance_company_id end)
        returning id into v_invoice;
        perform public.invoice_add_service_internal(v_invoice, s.id, 1, 'appointment')
          from public.services s
         where s.active and s.appointment_type = new.visit_type;
      end if;
    end if;
    if public.visit_has_ultrasound(new.id) then
      perform public.auto_charge(v_invoice, 'ultrasound');
    end if;
    perform public.apply_default_coverage(v_invoice);
  end if;
  return new;
end;
$$;

-- Extended in 0015 (ultrasound images / drawings).
create or replace function public.visit_has_ultrasound(p_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ultrasound_annotations ua where ua.visit_id = p_visit and jsonb_array_length(ua.strokes) > 0);
$$;

create trigger visits_billing after update of status on public.visits
  for each row execute function public.tg_visits_billing();

-- ---------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------
create or replace function public.accounting_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tz text := public.clinic_timezone();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
  v jsonb;
begin
  if not public.has_permission('accounting.view') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  with inv as (
    select * from public.invoices where status <> 'void' and issued_at >= v_start and issued_at < v_end
  ), pay as (
    select * from public.payments where received_at >= v_start and received_at < v_end
  )
  select jsonb_build_object(
    'revenue',            (select coalesce(sum(total), 0) from inv),
    'discounts',          (select coalesce(sum(discount_amount), 0) from inv),
    'invoices',           (select count(*) from inv),
    'paid_visits',        (select count(*) from inv where status in ('paid', 'no_charge')),
    'unpaid_visits',      (select count(*) from inv where status in ('open', 'partially_paid')),
    'services',           (select coalesce(sum(l.quantity), 0) from public.invoice_lines l join inv on inv.id = l.invoice_id where l.package_line_id is null),
    'collected',          (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) from pay),
    'cash',               (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) from pay where method = 'cash'),
    'card',               (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) from pay where method = 'card'),
    'insurance_received', (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) from pay where payer = 'insurance'),
    'refunds',            (select coalesce(sum(amount), 0) from pay where kind = 'refund'),
    'insurance_billed',   (select coalesce(sum(insurance_amount), 0) from inv),
    'outstanding_insurance', (select coalesce(sum(balance_insurance), 0) from public.invoices where status <> 'void' and balance_insurance > 0),
    'patient_balances',   (select coalesce(sum(balance_patient), 0) from public.invoices where status <> 'void' and balance_patient > 0),
    'by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by amt desc), '[]'::jsonb)
                    from (select method, sum(case when kind = 'payment' then amount else -amount end) amt from pay group by method) x),
    'by_doctor', (select coalesce(jsonb_agg(jsonb_build_object('doctor_id', doctor_id, 'name_en', d.display_name_en, 'name_ar', coalesce(d.display_name_ar, d.display_name_en), 'amount', amt, 'count', n) order by amt desc), '[]'::jsonb)
                    from (select doctor_id, sum(total) amt, count(*) n from inv group by doctor_id) x left join public.doctors d on d.id = x.doctor_id),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service_id', service_id, 'name_en', name_en, 'name_ar', name_ar, 'amount', amt, 'count', n) order by amt desc), '[]'::jsonb)
                    from (select l.service_id, max(l.description_en) name_en, max(l.description_ar) name_ar, sum(l.line_total) amt, sum(l.quantity) n
                            from public.invoice_lines l join inv on inv.id = l.invoice_id where l.package_line_id is null group by l.service_id) x),
    'by_insurance', (select coalesce(jsonb_agg(jsonb_build_object('insurance_company_id', insurance_company_id, 'name_en', c.name_en, 'name_ar', c.name_ar, 'billed', billed, 'outstanding', outstanding) order by billed desc), '[]'::jsonb)
                    from (select insurance_company_id, sum(insurance_amount) billed, sum(balance_insurance) outstanding from inv where insurance_company_id is not null group by insurance_company_id) x
                    left join public.insurance_companies c on c.id = x.insurance_company_id),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'revenue', revenue, 'collected', collected) order by day), '[]'::jsonb)
                from (select g::date as day,
                             (select coalesce(sum(total), 0) from inv where (issued_at at time zone v_tz)::date = g::date) revenue,
                             (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) from pay where (received_at at time zone v_tz)::date = g::date) collected
                        from generate_series(p_from, p_to, interval '1 day') g) d)
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.services enable row level security;
create policy services_read on public.services for select to authenticated using (true);
create policy services_insert on public.services for insert to authenticated with check (public.has_permission('pricing.manage'));
create policy services_update on public.services for update to authenticated
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));

alter table public.service_insurance_prices enable row level security;
create policy service_insurance_prices_read on public.service_insurance_prices for select to authenticated
  using (public.has_permission('pricing.view') or public.has_permission('accounting.view'));
create policy service_insurance_prices_write on public.service_insurance_prices for all to authenticated
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));

alter table public.service_package_items enable row level security;
create policy service_package_items_read on public.service_package_items for select to authenticated using (true);
create policy service_package_items_write on public.service_package_items for all to authenticated
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));

alter table public.service_price_history enable row level security;
create policy service_price_history_read on public.service_price_history for select to authenticated
  using (public.has_permission('pricing.view'));
revoke insert, update, delete, truncate on public.service_price_history from anon, authenticated;

alter table public.invoices enable row level security;
create policy invoices_select on public.invoices for select to authenticated
  using (public.has_permission('accounting.view') and public.can_access_patient(patient_id));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (public.has_permission('accounting.create') and public.can_access_patient(patient_id));
create policy invoices_update on public.invoices for update to authenticated
  using ((public.has_permission('accounting.create') or public.has_permission('accounting.edit')) and public.can_access_patient(patient_id))
  with check (public.has_permission('accounting.create') or public.has_permission('accounting.edit'));
revoke delete, truncate on public.invoices from anon, authenticated;

alter table public.invoice_lines enable row level security;
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy invoice_lines_write on public.invoice_lines for all to authenticated
  using (public.has_permission('accounting.create') and exists (select 1 from public.invoices i where i.id = invoice_id))
  with check (public.has_permission('accounting.create') and exists (select 1 from public.invoices i where i.id = invoice_id));

alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using (public.has_permission('accounting.view') and public.can_access_patient(patient_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.has_permission('accounting.create') and received_by = auth.uid()
              and exists (select 1 from public.invoices i where i.id = invoice_id));
revoke update, delete, truncate on public.payments from anon, authenticated;

alter table public.cash_registers enable row level security;
create policy cash_registers_select on public.cash_registers for select to authenticated using (public.has_permission('accounting.view'));
create policy cash_registers_insert on public.cash_registers for insert to authenticated with check (public.has_permission('accounting.close_day'));
create policy cash_registers_update on public.cash_registers for update to authenticated
  using (public.has_permission('accounting.close_day')) with check (public.has_permission('accounting.close_day'));

alter table public.cash_expenses enable row level security;
create policy cash_expenses_select on public.cash_expenses for select to authenticated using (public.has_permission('accounting.view'));
create policy cash_expenses_insert on public.cash_expenses for insert to authenticated
  with check (public.has_permission('accounting.create') and created_by = auth.uid());

alter table public.cash_register_adjustments enable row level security;
create policy cash_register_adjustments_select on public.cash_register_adjustments for select to authenticated using (public.has_permission('accounting.view'));
create policy cash_register_adjustments_insert on public.cash_register_adjustments for insert to authenticated
  with check (public.has_permission('accounting.edit') and created_by = auth.uid());

revoke execute on function public.recalc_invoice(uuid) from public, anon, authenticated;
revoke execute on function public.invoice_add_service_internal(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.appointment_invoice_internal(uuid) from public, anon, authenticated;
revoke execute on function public.auto_charge(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_default_coverage(uuid) from public, anon;
grant execute on function public.auto_charge(uuid, text) to service_role;

-- Touch + audit
do $$
declare
  t record;
begin
  for t in select * from (values ('services', 'id'), ('invoices', 'id'), ('invoice_lines', 'id'), ('cash_registers', 'id')) as x(tbl, key) loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_touch_row()', t.tbl || '_touch', t.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit(%L)', t.tbl || '_audit', t.tbl, t.key);
  end loop;
  for t in select * from (values ('payments'), ('cash_expenses'), ('cash_register_adjustments'), ('service_insurance_prices'), ('service_package_items')) as x(tbl) loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit(%L)', t.tbl || '_audit', t.tbl,
                   case when t.tbl in ('service_insurance_prices') then 'service_id' when t.tbl = 'service_package_items' then 'package_id' else 'id' end);
  end loop;
end;
$$;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['invoices', 'payments'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
