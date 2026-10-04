import { beforeAll, describe, expect, it } from "vitest"
import { createDb, createUser, type Db } from "./harness"

// Clinic workflow (migration 0016): clinic visits (encounters) separate from
// appointments, payment workflow, registration fee, working hours, doctor
// prices, discount limits, payment idempotency, drawing archive/restore.

let db: Db
let admin: string
let doctor: string
let reception: string
let doctorId: string
let artDept: string
let consultation: string
let ultrasound: string

type Row = Record<string, unknown>
const one = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T
const rows = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[]
const num = (v: unknown) => Number(v)

/** ISO timestamp for "today + n days at HH:MM" in Asia/Amman (UTC+3). */
function ammanAt(daysFromToday: number, time: string) {
  const now = new Date(Date.now() + 3 * 3600_000)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday))
  return `${d.toISOString().slice(0, 10)}T${time}:00+03:00`
}

async function registerPatient(name: string, visit: Record<string, unknown> | null = null) {
  return db.as(reception, () =>
    one<{ id: string; patient_code: string; encounter_id: string | null }>("select * from public.create_patient($1, '{}'::jsonb, $2)", [
      JSON.stringify({ full_name: name, phone: "0791234567", assigned_doctor_id: doctorId }),
      visit ? JSON.stringify(visit) : null,
    ]),
  )
}

const encounter = (id: string) => one<{ status: string; prepay: boolean; arrived_at: string; source: string; doctor_id: string }>("select * from encounters where id = $1", [id])
const invoiceOf = (encounterId: string) =>
  one<{ id: string; total: string; balance_patient: string; status: string }>("select * from invoices where encounter_id = $1 and status <> 'void'", [encounterId])
const linesOf = (invoiceId: string) =>
  rows<{ source: string; unit_price: string; description_en: string }>("select source, unit_price, description_en from invoice_lines where invoice_id = $1 order by sort_order", [invoiceId])

async function pay(invoiceId: string, amount: number, method = "cash") {
  return db.as(reception, () =>
    db.query("insert into payments (invoice_id, payer, method, amount, received_by) values ($1, 'patient', $2, $3, $4)", [invoiceId, method, amount, reception]),
  )
}

async function setPrepay(on: boolean) {
  await db.query("update clinic_settings set collect_payment_before_consultation = $1 where id = 1", [on])
}

beforeAll(async () => {
  db = await createDb()
  admin = await createUser(db, { email: "admin@clinic.test", role: "admin", name: "Admin" })
  doctor = await createUser(db, { email: "doctor@clinic.test", role: "doctor", name: "Dr. Test" })
  reception = await createUser(db, { email: "desk@clinic.test", role: "receptionist", name: "Desk" })
  doctorId = (await one<{ id: string }>("select id from doctors where profile_id = $1", [doctor])).id
  artDept = (await one<{ id: string }>("select id from departments where code = 'art'")).id
  consultation = (await one<{ id: string }>("select id from services where code = 'gynecology_consultation'")).id
  ultrasound = (await one<{ id: string }>("select id from services where code = 'ultrasound'")).id
}, 120_000)

describe("new patient → first clinic visit (pre-payment workflow)", () => {
  it("registers patient + visit + separate registration and consultation lines atomically", async () => {
    await setPrepay(true)
    const p = await registerPatient("First Visit", { service_id: consultation, reason: "Pelvic pain" })
    expect(p.encounter_id).toBeTruthy()
    const e = await encounter(p.encounter_id!)
    expect(e).toMatchObject({ status: "waiting_payment", prepay: true, source: "walk_in", doctor_id: doctorId })
    const inv = await invoiceOf(p.encounter_id!)
    const lines = await linesOf(inv.id)
    // Two identified services, not one merged amount.
    expect(lines.map((l) => [l.source, num(l.unit_price)])).toEqual([
      ["registration", 10],
      ["appointment", 20],
    ])
    expect(num(inv.total)).toBe(30)
    // Server clock, not the browser's.
    expect(Math.abs(Date.now() - new Date(e.arrived_at).getTime())).toBeLessThan(60_000)
  })

  it("rolls back the whole registration when the visit cannot be created", async () => {
    const before = (await one<{ n: number }>("select count(*)::int as n from patients")).n
    await expect(registerPatient("Broken", { service_id: crypto.randomUUID() })).rejects.toThrow(/Service not available/)
    expect((await one<{ n: number }>("select count(*)::int as n from patients")).n).toBe(before)
  })

  it("payment → doctor queue → doctor → completion (+ultrasound) → checkout", async () => {
    const p = await registerPatient("Queue Patient", { service_id: consultation })
    const enc = p.encounter_id!
    const inv = await invoiceOf(enc)
    // Not paid: the doctor's queue does not get the patient automatically.
    expect((await encounter(enc)).status).toBe("waiting_payment")
    await pay(inv.id, 30, "card")
    expect((await encounter(enc)).status).toBe("waiting_doctor")
    const notified = await one<{ n: number }>("select count(*)::int as n from notifications where recipient_id = $1 and entity_id = $2", [doctor, enc])
    expect(notified.n).toBe(1)

    // Doctor opens the medical visit from the queue.
    const visitId = await db.as(doctor, async () => (await one<{ id: string }>("select public.start_visit($1, 'gynecology', null, null, $2) as id", [p.id, enc])).id)
    expect((await encounter(enc)).status).toBe("with_doctor")
    expect((await one<{ encounter_id: string }>("select encounter_id from visits where id = $1", [visitId])).encounter_id).toBe(enc)
    await db.as(doctor, () => db.query("update gynecology_visits set complaint = 'Pain' where visit_id = $1", [visitId]))
    await db.as(doctor, () =>
      db.query(
        "insert into medical_drawings (patient_id, visit_id, template_key, shapes, canvas_width, canvas_height) values ($1, $2, 'pelvis_v1', $3, 1000, 700)",
        [p.id, visitId, JSON.stringify([{ id: "a1", type: "circle", x: 1, y: 2, w: 30, h: 20, color: "#e11d2e", size: 4 }])],
      ),
    )
    await db.as(doctor, () => db.query("select public.complete_visit($1)", [visitId]))
    expect((await encounter(enc)).status).toBe("awaiting_checkout")
    // Ultrasound was added to the same bill, which is now partly unpaid.
    const after = await invoiceOf(enc)
    expect((await linesOf(after.id)).map((l) => l.source)).toEqual(["registration", "appointment", "ultrasound"])
    expect(num(after.balance_patient)).toBe(25)

    // Checkout with a balance needs a reason; paying clears it.
    await expect(db.as(reception, () => db.query("select public.set_encounter_status($1, 'checked_out')", [enc]))).rejects.toThrow(/balance/)
    await pay(after.id, 25)
    await db.as(reception, () => db.query("select public.set_encounter_status($1, 'checked_out')", [enc]))
    expect((await encounter(enc)).status).toBe("checked_out")
  })

  it("sends an unpaid patient to the doctor only with a reason", async () => {
    const p = await registerPatient("Unpaid", { service_id: consultation })
    await expect(db.as(reception, () => db.query("select public.set_encounter_status($1, 'waiting_doctor')", [p.encounter_id]))).rejects.toThrow(/reason/)
    await db.as(reception, () => db.query("select public.set_encounter_status($1, 'waiting_doctor', 'Emergency')", [p.encounter_id]))
    expect((await encounter(p.encounter_id!)).status).toBe("waiting_doctor")
  })

  it("cancels an unpaid clinic visit (voiding its bill), never a paid one", async () => {
    const a = await registerPatient("Cancel Me", { service_id: consultation })
    await expect(db.as(reception, () => db.query("select public.set_encounter_status($1, 'cancelled')", [a.encounter_id]))).rejects.toThrow(/reason/)
    const inv = await invoiceOf(a.encounter_id!)
    await db.as(reception, () => db.query("select public.set_encounter_status($1, 'cancelled', 'Left before seeing the doctor')", [a.encounter_id]))
    expect((await one<{ status: string; void_reason: string }>("select status, void_reason from invoices where id = $1", [inv.id]))).toMatchObject({
      status: "void",
      void_reason: "Left before seeing the doctor",
    })
    const b = await registerPatient("Paid Cancel", { service_id: consultation })
    await pay((await invoiceOf(b.encounter_id!)).id, 5)
    await expect(db.as(reception, () => db.query("select public.set_encounter_status($1, 'cancelled', 'x reason')", [b.encounter_id]))).rejects.toThrow(/Refund/)
  })
})

describe("walk-in of an existing patient", () => {
  it("creates the visit now once (idempotent), without registration, visible in today's queue", async () => {
    const p = await registerPatient("Returning")
    // An earlier finished visit makes this patient "not new".
    const first = await db.as(reception, async () => (await one<{ id: string }>("select public.create_encounter($1, $2, $3) as id", [p.id, doctorId, consultation])).id)
    await pay((await invoiceOf(first)).id, 30)
    await db.as(doctor, () => db.query("select public.set_encounter_status($1, 'with_doctor')", [first]))
    await db.as(doctor, () => db.query("select public.set_encounter_status($1, 'awaiting_checkout')", [first]))
    await db.as(reception, () => db.query("select public.set_encounter_status($1, 'checked_out')", [first]))

    const id1 = await db.as(reception, async () => (await one<{ id: string }>("select public.create_encounter($1, $2, $3, 'Bleeding') as id", [p.id, doctorId, consultation])).id)
    const id2 = await db.as(reception, async () => (await one<{ id: string }>("select public.create_encounter($1, $2, $3, 'Bleeding') as id", [p.id, doctorId, consultation])).id)
    expect(id2).toBe(id1)
    expect((await linesOf((await invoiceOf(id1)).id)).map((l) => l.source)).toEqual(["appointment"])
    const queue = await db.as(doctor, () => rows<{ id: string }>("select id from encounters where queue_date = (now() at time zone 'Asia/Amman')::date and status not in ('checked_out', 'cancelled')"))
    expect(queue.map((q) => q.id)).toContain(id1)
    const tl = await db.as(admin, () => rows<{ event_type: string }>("select event_type from patient_timeline where patient_id = $1", [p.id]))
    expect(tl.map((t) => t.event_type)).toEqual(expect.arrayContaining(["clinic_visit", "checked_out"]))
  })

  it("lets only the database functions write clinic visits", async () => {
    const p = await registerPatient("Direct Write")
    await expect(
      db.as(reception, () => db.query("insert into encounters (patient_id, status, prepay) values ($1, 'waiting_doctor', false)", [p.id])),
    ).rejects.toThrow(/permission denied/)
    const id = await db.as(reception, async () => (await one<{ id: string }>("select public.create_encounter($1, $2, $3) as id", [p.id, doctorId, consultation])).id)
    await expect(db.as(reception, () => db.query("update encounters set status = 'checked_out' where id = $1", [id]))).rejects.toThrow(/permission denied/)
    // A receptionist cannot call the patient in as the doctor.
    await expect(db.as(reception, () => db.query("select public.set_encounter_status($1, 'with_doctor')", [id]))).rejects.toThrow(/Not allowed/)
  })
})

describe("post-payment workflow (payment after the doctor)", () => {
  it("queues the patient for the doctor first; the doctor completes the bill within limits", async () => {
    await setPrepay(false)
    const p = await registerPatient("Pay Later", { service_id: consultation })
    expect((await encounter(p.encounter_id!)).status).toBe("waiting_doctor")
    const inv = await invoiceOf(p.encounter_id!)
    // Doctor sees and completes the bill (no accounting.view needed)...
    await db.as(doctor, () => db.query("select public.add_invoice_service($1, $2)", [inv.id, ultrasound]))
    await expect(
      db.as(doctor, () => db.query("update invoices set discount_type = 'percent', discount_value = 60, discount_reason = 'Hardship' where id = $1", [inv.id])),
    ).rejects.toThrow(/limit/)
    await db.as(doctor, () => db.query("update invoices set discount_type = 'fixed', discount_value = 5, discount_reason = 'Follow-up soon' where id = $1", [inv.id]))
    // ...but can neither take payments nor see them.
    await expect(
      db.as(doctor, () => db.query("insert into payments (invoice_id, payer, method, amount, received_by) values ($1, 'patient', 'cash', 1, $2)", [inv.id, doctor])),
    ).rejects.toThrow()
    await db.as(doctor, () => db.query("select public.set_encounter_status($1, 'with_doctor')", [p.encounter_id]))
    await db.as(doctor, () => db.query("select public.set_encounter_status($1, 'awaiting_checkout')", [p.encounter_id]))
    const final = await invoiceOf(p.encounter_id!)
    expect([num(final.total), num(final.balance_patient)]).toEqual([10 + 20 + 25 - 5, 50])
    await pay(final.id, 50)
    await db.as(reception, () => db.query("select public.set_encounter_status($1, 'checked_out')", [p.encounter_id]))
    expect((await encounter(p.encounter_id!)).status).toBe("checked_out")
    await setPrepay(true)
  })
})

describe("appointments vs clinic visits", () => {
  it("opens a clinic visit with its bill when an appointment is checked in", async () => {
    await db.query("update clinic_settings set enforce_working_hours = false where id = 1")
    const p = await registerPatient("Booked")
    const appt = await db.as(reception, () =>
      one<{ id: string; version: number }>(
        "insert into appointments (patient_id, doctor_id, department_id, visit_type, scheduled_at, service_id) values ($1, $2, $3, 'gynecology', $4, $5) returning id, version",
        [p.id, doctorId, artDept, ammanAt(0, "10:00"), consultation],
      ),
    )
    expect((await rows("select id from encounters where appointment_id = $1", [appt.id])).length).toBe(0)
    await db.as(reception, () => db.query("update appointments set status = 'checked_in' where id = $1", [appt.id]))
    const e = await one<{ id: string; source: string; status: string }>("select * from encounters where appointment_id = $1", [appt.id])
    expect(e).toMatchObject({ source: "appointment", status: "waiting_payment" })
    const inv = await one<{ appointment_id: string; encounter_id: string }>("select appointment_id, encounter_id from invoices where encounter_id = $1", [e.id])
    expect(inv.appointment_id).toBe(appt.id)
    // The same bill is used by the appointment checkout (no duplicate).
    const viaAppt = await db.as(reception, async () => (await one<{ id: string }>("select public.ensure_appointment_invoice($1) as id", [appt.id])).id)
    expect(viaAppt).toBe((await invoiceOf(e.id)).id)
    await db.query("update clinic_settings set enforce_working_hours = true where id = 1")
  })
})

describe("working hours", () => {
  const insert = (as: string, time: string, outside: boolean, daysAhead = 2) =>
    db.as(as, async () => {
      const p = await one<{ id: string }>("insert into patients (full_name, phone) values ('Hours', '0790000001') returning id")
      return one<{ id: string; outside_working_hours: boolean }>(
        "insert into appointments (patient_id, doctor_id, department_id, visit_type, scheduled_at, outside_working_hours) values ($1, $2, $3, 'gynecology', $4, $5) returning id, outside_working_hours",
        [p.id, doctorId, artDept, ammanAt(daysAhead, time), outside],
      )
    })

  it("requires an explicit, permitted decision outside working hours and flags it", async () => {
    await db.query("update clinic_settings set enforce_working_hours = true, working_hours_start = '09:00', working_hours_end = '18:00' where id = 1")
    expect((await insert(reception, "10:00", true)).outside_working_hours).toBe(false)
    await expect(insert(reception, "20:00", false)).rejects.toThrow(/outside the configured working hours/)
    expect((await insert(reception, "20:00", true)).outside_working_hours).toBe(true)
    // 17:50 + 15 minutes ends after closing.
    await expect(insert(reception, "17:50", false, 3)).rejects.toThrow(/outside/)
  })

  it("denies outside-hours booking to roles without the permission", async () => {
    await db.as(admin, () =>
      db.query("update roles set active = active where code = 'doctor'"),
    )
    await db.query(
      "insert into role_permissions (role_id, permission_code) select id, 'appointments.create' from roles where code = 'doctor' on conflict do nothing",
    )
    await expect(insert(doctor, "21:00", true, 4)).rejects.toThrow(/not allowed/)
  })

  it("uses the doctor's own schedule when configured", async () => {
    await db.as(admin, () => db.query("insert into doctor_working_hours (doctor_id, weekday, start_time, end_time) select $1, d, '14:00', '22:00' from generate_series(0, 6) d", [doctorId]))
    expect((await insert(reception, "21:00", false, 5)).outside_working_hours).toBe(false)
    await expect(insert(reception, "10:00", false, 5)).rejects.toThrow(/outside/)
    await db.as(admin, () => db.query("delete from doctor_working_hours where doctor_id = $1", [doctorId]))
  })
})

describe("pricing and payments", () => {
  it("charges the doctor's own price and snapshots it", async () => {
    await db.as(admin, () => db.query("insert into doctor_service_prices (doctor_id, service_id, price_cash) values ($1, $2, 35)", [doctorId, consultation]))
    const p = await registerPatient("Doctor Price", { service_id: consultation })
    const lines = await linesOf((await invoiceOf(p.encounter_id!)).id)
    expect(lines.find((l) => l.source === "appointment")!.unit_price).toBe("35.000")
    await db.as(admin, () => db.query("update doctor_service_prices set price_cash = 50 where doctor_id = $1", [doctorId]))
    expect((await linesOf((await invoiceOf(p.encounter_id!)).id)).find((l) => l.source === "appointment")!.unit_price).toBe("35.000")
    await db.as(admin, () => db.query("delete from doctor_service_prices where doctor_id = $1", [doctorId]))
  })

  it("records a payment once per idempotency key and only with enabled methods", async () => {
    const p = await registerPatient("Idempotent", { service_id: consultation })
    const inv = await invoiceOf(p.encounter_id!)
    const key = crypto.randomUUID()
    const insert = () =>
      db.as(reception, () =>
        db.query("insert into payments (invoice_id, payer, method, amount, received_by, idempotency_key) values ($1, 'patient', 'cash', 5, $2, $3)", [inv.id, reception, key]),
      )
    await insert()
    await expect(insert()).rejects.toThrow(/duplicate key|unique/)
    expect((await one<{ n: number }>("select count(*)::int as n from payments where invoice_id = $1", [inv.id])).n).toBe(1)
    await db.query("update clinic_settings set payment_methods = '{cash}' where id = 1")
    await expect(pay(inv.id, 1, "card")).rejects.toThrow(/not enabled/)
    await db.query("update clinic_settings set payment_methods = '{cash,card,transfer,other}' where id = 1")
  })

  it("marks an invoice refunded when all payments were refunded", async () => {
    const p = await registerPatient("Refund All", { service_id: consultation })
    const inv = await invoiceOf(p.encounter_id!)
    await pay(inv.id, 30)
    const payment = await one<{ id: string }>("select id from payments where invoice_id = $1", [inv.id])
    await db.as(admin, () =>
      db.query("insert into payments (invoice_id, payer, method, amount, kind, refund_of_id, reason, received_by) values ($1, 'patient', 'cash', 30, 'refund', $2, 'Service not given', $3)", [inv.id, payment.id, admin]),
    )
    expect((await one<{ status: string }>("select status from invoices where id = $1", [inv.id])).status).toBe("refunded")
  })
})

describe("ultrasound drawings: delete (archive) and restore", () => {
  it("archives with a reason and who/when, restores only with permission, never edits archived drawings", async () => {
    const p = await registerPatient("Drawing Archive", { service_id: consultation })
    await db.as(reception, () => db.query("select public.set_encounter_status($1, 'waiting_doctor', 'Test')", [p.encounter_id]))
    const visitId = await db.as(doctor, async () => (await one<{ id: string }>("select public.start_visit($1, 'gynecology', null, null, $2) as id", [p.id, p.encounter_id])).id)
    const d = await db.as(doctor, () =>
      one<{ id: string }>(
        "insert into medical_drawings (patient_id, visit_id, template_key, shapes, canvas_width, canvas_height) values ($1, $2, 'pelvis_v1', '[]', 1000, 700) returning id",
        [p.id, visitId],
      ),
    )
    await expect(db.as(doctor, () => db.query("update medical_drawings set status = 'archived' where id = $1", [d.id]))).rejects.toThrow(/reason/)
    await db.as(doctor, () => db.query("update medical_drawings set status = 'archived' where id = $1", [d.id]), "Wrong image")
    const archived = await one<{ archived_by: string; archive_reason: string; archived_at: string | null }>("select * from medical_drawings where id = $1", [d.id])
    expect(archived).toMatchObject({ archived_by: doctor, archive_reason: "Wrong image" })
    await expect(db.as(doctor, () => db.query("update medical_drawings set shapes = '[{\"id\":\"x\"}]' where id = $1", [d.id]))).rejects.toThrow(/Restore/)
    // Receptionists do not even see drawings (RLS): nothing is restored.
    await db.as(reception, () => db.query("update medical_drawings set status = 'active' where id = $1", [d.id]))
    expect((await one<{ status: string }>("select status from medical_drawings where id = $1", [d.id])).status).toBe("archived")
    await db.as(doctor, () => db.query("update medical_drawings set status = 'active' where id = $1", [d.id]))
    expect((await one<{ status: string; archived_at: string | null }>("select status, archived_at from medical_drawings where id = $1", [d.id]))).toEqual({ status: "active", archived_at: null })
  })
})
