import { beforeAll, describe, expect, it } from "vitest"
import { createDb, createUser, type Db } from "./harness"

let db: Db
let admin: string
let doctor: string
let reception: string
let doctorId: string
let artDept: string
let insuranceId: string

type Row = Record<string, unknown>
const one = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T
const rows = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[]
const num = (v: unknown) => Number(v)

async function newPatient(name: string, insurance = false) {
  return db.as(reception, () =>
    one<{ id: string }>(
      insurance
        ? "insert into patients (full_name, phone, payment_method, insurance_company_id) values ($1, '0790000000', 'insurance', $2) returning id"
        : "insert into patients (full_name, phone) values ($1, '0790000000') returning id",
      insurance ? [name, insuranceId] : [name],
    ),
  )
}

let slot = 0
async function bookToday(patientId: string, visitType = "gynecology") {
  slot++
  const at = new Date(Date.now() + slot * 3600_000 + 86400_000 * 3).toISOString()
  return db.as(reception, () =>
    one<{ id: string }>(
      "insert into appointments (patient_id, doctor_id, department_id, visit_type, scheduled_at, status) values ($1, $2, $3, $4, $5, 'checked_in') returning id",
      [patientId, doctorId, artDept, visitType, at],
    ),
  )
}

/** Doctor starts and completes a gynecology visit from an appointment. */
async function completeGynVisit(patientId: string, appointmentId: string, withDrawing = false) {
  const visitId = await db.as(doctor, async () => (await one<{ id: string }>("select public.start_visit($1, 'gynecology', $2) as id", [patientId, appointmentId])).id)
  await db.as(doctor, () => db.query("update gynecology_visits set complaint = 'Pelvic pain' where visit_id = $1", [visitId]))
  if (withDrawing) {
    await db.as(doctor, () =>
      db.query(
        "insert into medical_drawings (patient_id, visit_id, template_key, shapes, canvas_width, canvas_height) values ($1, $2, 'pelvis_v1', $3, 1000, 700)",
        [patientId, visitId, JSON.stringify([{ type: "arrow", points: [1, 2, 3, 4], color: "#f00", size: 4 }])],
      ),
    )
  }
  await db.as(doctor, () => db.query("select public.complete_visit($1)", [visitId]))
  return visitId
}

beforeAll(async () => {
  db = await createDb()
  admin = await createUser(db, { email: "admin@clinic.test", role: "admin", name: "Admin" })
  doctor = await createUser(db, { email: "doctor@clinic.test", role: "doctor", name: "Dr. Test" })
  reception = await createUser(db, { email: "desk@clinic.test", role: "receptionist", name: "Desk" })
  doctorId = (await one<{ id: string }>("select id from doctors where profile_id = $1", [doctor])).id
  artDept = (await one<{ id: string }>("select id from departments where code = 'art'")).id
  insuranceId = (
    await one<{ id: string }>("insert into insurance_companies (code, name_en, name_ar, default_coverage_percent) values ('nat', 'National', 'الوطنية', 70) returning id")
  ).id
}, 120_000)

describe("automatic billing from clinical actions", () => {
  it("creates the visit invoice when the doctor completes the visit (with ultrasound) and snapshots prices", async () => {
    const p = await newPatient("Billing Patient")
    const a = await bookToday(p.id)
    const visitId = await completeGynVisit(p.id, a.id, true)
    const inv = await one<{ id: string; invoice_number: string; total: string; status: string; visit_id: string }>(
      "select id, invoice_number, total, status, visit_id from invoices where appointment_id = $1",
      [a.id],
    )
    expect(inv.invoice_number).toMatch(/^INV-\d{4}-\d{6}$/)
    expect(inv.visit_id).toBe(visitId)
    const lines = await rows<{ source: string; unit_price: string }>("select source, unit_price from invoice_lines where invoice_id = $1 order by sort_order", [inv.id])
    expect(lines.map((l) => [l.source, num(l.unit_price)])).toEqual([
      ["appointment", 20],
      ["ultrasound", 25],
    ])
    expect(num(inv.total)).toBe(45)
    expect(inv.status).toBe("open")
    // Later price changes never alter historical invoices.
    await db.as(admin, () => db.query("update services set price_cash = 30 where code = 'gynecology_consultation'"))
    expect(num((await one<{ total: string }>("select total from invoices where id = $1", [inv.id])).total)).toBe(45)
    expect((await one<{ n: number }>("select count(*)::int as n from service_price_history s join services v on v.id = s.service_id where v.code = 'gynecology_consultation'")).n).toBe(2)
    await db.as(admin, () => db.query("update services set price_cash = 20 where code = 'gynecology_consultation'"))
  })

  it("supports no-charge appointments", async () => {
    const p = await newPatient("Free Patient")
    const a = await bookToday(p.id)
    await db.query("update appointments set no_charge = true where id = $1", [a.id])
    const invoiceId = await db.as(reception, async () => (await one<{ id: string }>("select public.ensure_appointment_invoice($1) as id", [a.id])).id)
    const inv = await one<{ total: string; status: string }>("select total, status from invoices where id = $1", [invoiceId])
    expect(num(inv.total)).toBe(0)
    expect(inv.status).toBe("open")
  })
})

describe("payments, discounts, refunds", () => {
  let invoiceId: string
  beforeAll(async () => {
    const p = await newPatient("Cash Patient")
    const a = await bookToday(p.id, "fertility")
    invoiceId = await db.as(reception, async () => (await one<{ id: string }>("select public.ensure_appointment_invoice($1) as id", [a.id])).id)
    const ultra = (await one<{ id: string }>("select id from services where code = 'ultrasound'")).id
    await db.as(reception, () => db.query("select public.add_invoice_service($1, $2)", [invoiceId, ultra]))
  })

  it("only authorized users apply discounts; totals are computed in the database", async () => {
    await expect(db.as(reception, () => db.query("update invoices set discount_type = 'percent', discount_value = 10 where id = $1", [invoiceId]))).rejects.toThrow(/discount/)
    await db.as(admin, () => db.query("update invoices set discount_type = 'percent', discount_value = 10, total = 1 where id = $1", [invoiceId]))
    const inv = await one<{ subtotal: string; discount_amount: string; total: string; balance_patient: string }>("select * from invoices where id = $1", [invoiceId])
    expect([num(inv.subtotal), num(inv.discount_amount), num(inv.total), num(inv.balance_patient)]).toEqual([50, 5, 45, 45])
  })

  it("records mixed payments, rejects overpayment and keeps payments immutable", async () => {
    await db.as(reception, () => db.query("insert into payments (invoice_id, payer, method, amount, received_by) values ($1, 'patient', 'cash', 30, $2)", [invoiceId, reception]))
    let inv = await one<{ status: string; balance_patient: string }>("select status, balance_patient from invoices where id = $1", [invoiceId])
    expect(inv).toMatchObject({ status: "partially_paid" })
    await expect(
      db.as(reception, () => db.query("insert into payments (invoice_id, payer, method, amount, received_by) values ($1, 'patient', 'card', 20, $2)", [invoiceId, reception])),
    ).rejects.toThrow(/exceeds/)
    const pay = await db.as(reception, () =>
      one<{ id: string; receipt_number: string }>("insert into payments (invoice_id, payer, method, amount, received_by) values ($1, 'patient', 'card', 15, $2) returning id, receipt_number", [invoiceId, reception]),
    )
    expect(pay.receipt_number).toMatch(/^RCT-\d{4}-\d{6}$/)
    inv = await one("select status, balance_patient from invoices where id = $1", [invoiceId])
    expect(inv.status).toBe("paid")
    expect(num(inv.balance_patient)).toBe(0)
    await expect(db.as(admin, () => db.query("update payments set amount = 1 where id = $1", [pay.id]))).rejects.toThrow()
  })

  it("corrects paid invoices only with permission and reason; refunds need permission and a reason", async () => {
    const line = await one<{ id: string }>("select id from invoice_lines where invoice_id = $1 limit 1", [invoiceId])
    await expect(db.as(reception, () => db.query("update invoice_lines set quantity = 2 where id = $1", [line.id]))).rejects.toThrow(/authorized/)
    await expect(db.as(admin, () => db.query("update invoice_lines set quantity = 2 where id = $1", [line.id]))).rejects.toThrow(/reason/)
    const cardPay = await one<{ id: string }>("select id from payments where invoice_id = $1 and method = 'card'", [invoiceId])
    await expect(
      db.as(reception, () => db.query("insert into payments (invoice_id, payer, method, amount, kind, refund_of_id, reason, received_by) values ($1, 'patient', 'card', 5, 'refund', $2, 'Overcharge', $3)", [invoiceId, cardPay.id, reception])),
    ).rejects.toThrow(/not allowed/)
    await expect(
      db.as(admin, () => db.query("insert into payments (invoice_id, payer, method, amount, kind, refund_of_id, reason, received_by) values ($1, 'patient', 'card', 50, 'refund', $2, 'Too much', $3)", [invoiceId, cardPay.id, admin])),
    ).rejects.toThrow(/refundable/)
    await db.as(admin, () => db.query("insert into payments (invoice_id, payer, method, amount, kind, refund_of_id, reason, received_by) values ($1, 'patient', 'card', 5, 'refund', $2, 'Goodwill', $3)", [invoiceId, cardPay.id, admin]))
    const inv = await one<{ status: string; balance_patient: string; refunded_total: string }>("select * from invoices where id = $1", [invoiceId])
    expect([inv.status, num(inv.balance_patient), num(inv.refunded_total)]).toEqual(["partially_paid", 5, 5])
    await expect(db.as(admin, () => db.query("update invoices set status = 'void' where id = $1", [invoiceId]), "test")).rejects.toThrow(/Refund/)
  })

  it("splits insurance and patient shares with the company coverage", async () => {
    const p = await newPatient("Insured Patient", true)
    const a = await bookToday(p.id, "fertility")
    const id = await db.as(reception, async () => (await one<{ id: string }>("select public.ensure_appointment_invoice($1) as id", [a.id])).id)
    const inv = await one<{ payment_type: string; total: string; insurance_amount: string; patient_amount: string }>("select * from invoices where id = $1", [id])
    expect(inv.payment_type).toBe("insurance")
    expect([num(inv.total), num(inv.insurance_amount), num(inv.patient_amount)]).toEqual([20, 14, 6])
    await db.as(reception, () => db.query("insert into payments (invoice_id, payer, method, amount, received_by) values ($1, 'patient', 'cash', 6, $2)", [id, reception]))
    expect((await one<{ status: string }>("select status from invoices where id = $1", [id])).status).toBe("partially_paid")
    await db.as(reception, () => db.query("insert into payments (invoice_id, payer, method, amount, reference, received_by) values ($1, 'insurance', 'insurance', 14, 'CLM-1', $2)", [id, reception]))
    expect((await one<{ status: string; balance_insurance: string }>("select status, balance_insurance from invoices where id = $1", [id]))).toMatchObject({ status: "paid" })
  })

  it("expands packages into zero-priced components (no double charge)", async () => {
    const pkg = await db.as(admin, () =>
      one<{ id: string }>("insert into services (code, category, name_en, name_ar, price_cash) values ('preg_pkg', 'package', 'Pregnancy package', 'باقة الحمل', 150) returning id"),
    )
    await db.as(admin, () =>
      db.query("insert into service_package_items (package_id, service_id, quantity) select $1, id, 2 from services where code in ('pregnancy_consultation', 'ultrasound')", [pkg.id]),
    )
    const p = await newPatient("Package Patient")
    const a = await bookToday(p.id, "consultation")
    const id = await db.as(reception, async () => (await one<{ id: string }>("select public.ensure_appointment_invoice($1) as id", [a.id])).id)
    await db.as(reception, () => db.query("select public.add_invoice_service($1, $2)", [id, pkg.id]))
    const lines = await rows<{ line_total: string; package_line_id: string | null }>("select line_total, package_line_id from invoice_lines where invoice_id = $1", [id])
    expect(lines.filter((l) => l.package_line_id).every((l) => num(l.line_total) === 0)).toBe(true)
    expect(num((await one<{ total: string }>("select total from invoices where id = $1", [id])).total)).toBe(170)
  })
})

describe("daily cash register", () => {
  it("computes expected cash on close, then locks the day", async () => {
    const today = (await one<{ d: string }>("select ((now() at time zone 'Asia/Amman')::date)::text as d")).d
    await db.as(reception, () => db.query("insert into cash_registers (register_date, opening_balance) values ($1, 10)", [today]))
    await db.as(reception, () => db.query("insert into cash_expenses (register_date, amount, description, created_by) values ($1, 3, 'Supplies', $2)", [today, reception]))
    const cash = num((await one<{ s: string }>("select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) as s from payments where register_date = $1 and method = 'cash'", [today])).s)
    await db.as(reception, () => db.query("update cash_registers set status = 'closed', actual_cash = $2 where register_date = $1", [today, 10 + cash - 3 - 1]))
    const r = await one<{ expected_cash: string; difference: string }>("select * from cash_registers where register_date = $1", [today])
    expect([num(r.expected_cash), num(r.difference)]).toEqual([10 + cash - 3, -1])
    await expect(db.as(admin, () => db.query("update cash_registers set actual_cash = 0 where register_date = $1", [today]))).rejects.toThrow(/closed/)
    const open = await one<{ id: string }>("select id from invoices where status in ('open', 'partially_paid') and balance_patient > 0 limit 1")
    await expect(
      db.as(reception, () => db.query("insert into payments (invoice_id, payer, method, amount, received_by) values ($1, 'patient', 'cash', 1, $2)", [open.id, reception])),
    ).rejects.toThrow(/closed/)
    const reg = await one<{ id: string }>("select id from cash_registers where register_date = $1", [today])
    await db.as(admin, () => db.query("insert into cash_register_adjustments (register_id, amount, reason, created_by) values ($1, 1, 'Counted again', $2)", [reg.id, admin]))
  })

  it("provides the accounting dashboard only to authorized users", async () => {
    const s = await db.as(admin, () => one<{ v: Record<string, unknown> }>("select public.accounting_summary(current_date - 1, current_date + 7) as v"))
    expect(num(s.v.revenue)).toBeGreaterThan(0)
    expect(Array.isArray(s.v.by_service)).toBe(true)
    await expect(db.as(doctor, () => db.query("select public.accounting_summary(current_date, current_date)"))).rejects.toThrow(/Not allowed/)
    expect(await db.as(doctor, () => rows("select id from invoices"))).toHaveLength(0)
  })
})

describe("drawings, prescriptions, reports", () => {
  it("keeps drawing history: sealed at completion, corrections need a reason", async () => {
    const p = await newPatient("Drawing Patient")
    const a = await bookToday(p.id)
    const visitId = await completeGynVisit(p.id, a.id, true)
    const d = await one<{ id: string; saved_versions: number }>("select id, saved_versions from medical_drawings where visit_id = $1", [visitId])
    expect(d.saved_versions).toBe(1)
    await expect(db.as(doctor, () => db.query("update medical_drawings set notes = 'x' where id = $1", [d.id]))).rejects.toThrow(/reason/)
    await db.as(doctor, () => db.query("update medical_drawings set shapes = '[]', notes = 'corrected' where id = $1", [d.id]), "Wrong side")
    const versions = await rows<{ version_no: number; shapes: unknown[] }>("select version_no, shapes from medical_drawing_versions where drawing_id = $1 order by version_no", [d.id])
    expect(versions).toHaveLength(1)
    expect(versions[0].shapes).toHaveLength(1)
    expect(await db.as(reception, () => rows("select id from medical_drawings"))).toHaveLength(0)
  })

  it("numbers prescriptions, issues them on visit completion and locks them", async () => {
    const p = await newPatient("Rx Patient")
    const a = await bookToday(p.id)
    const visitId = await db.as(doctor, async () => (await one<{ id: string }>("select public.start_visit($1, 'gynecology', $2) as id", [p.id, a.id])).id)
    const rx = await db.as(doctor, () => one<{ id: string; prescription_number: string }>("insert into prescriptions (patient_id, visit_id, doctor_id) values ($1, $2, $3) returning id, prescription_number", [p.id, visitId, doctorId]))
    expect(rx.prescription_number).toMatch(/^RX-\d{4}-\d{6}$/)
    const med = await db.as(doctor, () => one<{ id: string; name_en: string }>("select * from public.search_medications('Fo') limit 1"))
    expect(med.name_en).toBe("Folic Acid")
    await db.as(doctor, () => db.query("insert into prescription_items (prescription_id, medication_id, medication_name, dose, frequency, duration) values ($1, $2, 'Folic Acid 5 mg', '1 tablet', 'Once daily', '3 months')", [rx.id, med.id]))
    await db.as(doctor, () => db.query("update gynecology_visits set complaint = 'Check' where visit_id = $1", [visitId]))
    await db.as(doctor, () => db.query("select public.complete_visit($1)", [visitId]))
    expect((await one<{ status: string }>("select status from prescriptions where id = $1", [rx.id])).status).toBe("issued")
    await expect(db.as(doctor, () => db.query("update prescription_items set dose = '2' where prescription_id = $1", [rx.id]))).rejects.toThrow(/issued/)
    await expect(db.as(doctor, () => db.query("update prescriptions set status = 'cancelled' where id = $1", [rx.id]))).rejects.toThrow(/reason/)
    await db.as(doctor, () => db.query("update prescriptions set status = 'cancelled' where id = $1", [rx.id]), "Allergy")
    expect(await db.as(reception, () => rows("select id from prescriptions"))).toHaveLength(0)
  })

  it("creates standalone reports without a patient and patient reports that are billed and versioned", async () => {
    const standalone = await db.as(doctor, () =>
      one<{ id: string; report_number: string }>(
        "insert into medical_reports (subject_name, subject_age, subject_country, language, body_en, doctor_id) values ('Rosol Khalidy', 32, 'Iraq', 'en', 'To whom it may concern', $1) returning id, report_number",
        [doctorId],
      ),
    )
    expect(standalone.report_number).toMatch(/^MED-\d{4}-\d{6}$/)
    expect(await db.as(reception, () => rows("select id from medical_reports"))).toHaveLength(0)
    expect(await db.as(doctor, () => rows("select id from medical_reports"))).toHaveLength(1)
    expect(await db.query("select count(*)::int as n from patients where full_name = 'Rosol Khalidy'")).toMatchObject({ rows: [{ n: 0 }] })

    const p = await newPatient("Report Patient")
    const r = await db.as(doctor, () =>
      one<{ id: string }>("insert into medical_reports (patient_id, subject_name, language, body_en, doctor_id) values ($1, 'Report Patient', 'en', 'v1', $2) returning id", [p.id, doctorId]),
    )
    await db.as(doctor, () => db.query("update medical_reports set status = 'final' where id = $1", [r.id]))
    const charged = await one<{ n: number }>(
      "select count(*)::int as n from invoice_lines l join invoices i on i.id = l.invoice_id where i.patient_id = $1 and l.source = 'medical_report'",
      [p.id],
    )
    expect(charged.n).toBe(1)
    await db.as(doctor, () => db.query("update medical_reports set body_en = 'v2' where id = $1", [r.id]))
    const v = await one<{ snapshot: { body_en: string } }>("select snapshot from medical_report_versions where report_id = $1", [r.id])
    expect(v.snapshot.body_en).toBe("v1")
    // A standalone report can be linked to a patient once, never moved.
    await db.as(doctor, () => db.query("update medical_reports set patient_id = $1 where id = $2", [p.id, standalone.id]))
    const other = await newPatient("Other")
    await expect(db.as(admin, () => db.query("update medical_reports set patient_id = $1 where id = $2", [other.id, standalone.id]))).rejects.toThrow(/cannot be moved/)
  })

  it("shows drawings, prescriptions, reports, invoices and payments in the patient timeline", async () => {
    const types = await db.as(admin, () => rows<{ event_type: string }>("select distinct event_type from patient_timeline"))
    const set = new Set(types.map((t) => t.event_type))
    for (const t of ["drawing", "prescription", "medical_report", "invoice", "payment"]) expect(set.has(t)).toBe(true)
  })
})
