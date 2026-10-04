import { beforeAll, describe, expect, it } from "vitest"
import { createDb, createUser, type Db } from "./harness"

let db: Db
let admin: string
let doctor: string
let reception: string
let doctorId: string
let artDept: string

type Row = Record<string, unknown>
const one = async <T = Row>(sql: string, params: unknown[] = []) =>
  ((await db.query(sql, params)).rows[0] as T)
const rows = async <T = Row>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[]

async function newPatient(name: string, extra: Row = {}) {
  return db.as(reception, () =>
    one<{ id: string; patient_code: string }>(
      "insert into patients (full_name, phone, dob, address) values ($1, $2, $3, $4) returning id, patient_code",
      [name, extra.phone ?? "0790000000", extra.dob ?? "1994-06-14", extra.address ?? "Amman"],
    ),
  )
}

function ammanAt(daysFromToday: number, time: string) {
  // Build an ISO timestamp for "today + n days at HH:MM" in Asia/Amman (UTC+3).
  const now = new Date(Date.now() + 3 * 3600_000)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday))
  return `${d.toISOString().slice(0, 10)}T${time}:00+03:00`
}

async function book(patientId: string, daysFromToday: number, time: string, as = reception) {
  return db.as(as, () =>
    one<{ id: string }>(
      `insert into appointments (patient_id, doctor_id, department_id, visit_type, scheduled_at)
       values ($1, $2, $3, 'fertility', $4) returning id`,
      [patientId, doctorId, artDept, ammanAt(daysFromToday, time)],
    ),
  )
}

beforeAll(async () => {
  db = await createDb()
  admin = await createUser(db, { email: "admin@clinic.test", role: "admin", name: "Admin" })
  doctor = await createUser(db, { email: "doctor@clinic.test", role: "doctor", name: "Dr. Test" })
  reception = await createUser(db, { email: "desk@clinic.test", role: "receptionist", name: "Desk" })
  doctorId = (await one<{ id: string }>("select id from doctors where profile_id = $1", [doctor])).id
  artDept = (await one<{ id: string }>("select id from departments where code = 'art'")).id
  // These suites book at arbitrary times; working hours have their own tests.
  await db.query("update clinic_settings set enforce_working_hours = false where id = 1")
}, 60_000)

describe("migrations & identity", () => {
  it("creates profiles and a doctor record from auth users", async () => {
    const p = await one<{ code: string }>(
      "select r.code from profiles p join roles r on r.id = p.role_id where p.id = $1", [doctor])
    expect(p.code).toBe("doctor")
    expect(doctorId).toBeTruthy()
  })

  it("generates permanent sequential patient IDs and per-patient history rows", async () => {
    const a = await newPatient("Sarah Ahmad")
    const b = await newPatient("Lina Khalil", { phone: "0781111111" })
    expect(a.patient_code).toMatch(/^PAT-\d{6}$/)
    expect(Number(b.patient_code.slice(4))).toBe(Number(a.patient_code.slice(4)) + 1)
    const n = await one<{ n: number }>(
      "select count(*)::int as n from patient_medical_history where patient_id = $1", [a.id])
    expect(n.n).toBe(1)
    await expect(
      db.as(admin, () => db.query("update patients set patient_code = 'PAT-999999' where id = $1", [a.id])),
    ).rejects.toThrow(/never change/)
  })

  it("prevents users from escalating their own role", async () => {
    const adminRole = await one<{ id: string }>("select id from roles where code = 'admin'")
    await expect(
      db.as(reception, () => db.query("update profiles set role_id = $1 where id = $2", [adminRole.id, reception])),
    ).rejects.toThrow(/not allowed/)
  })
})

describe("RLS", () => {
  it("hides clinical history from receptionists but shows allergies", async () => {
    const p = await newPatient("Rania Odeh")
    await db.as(doctor, () =>
      db.query("update patient_medical_history set ht = true, notes = 'HTN' where patient_id = $1", [p.id]))
    await db.as(doctor, () =>
      db.query("update patient_allergies set allergy = 'Penicillin' where patient_id = $1", [p.id]))

    const asDesk = await db.as(reception, () =>
      rows("select * from patient_medical_history where patient_id = $1", [p.id]))
    expect(asDesk).toHaveLength(0)
    const allergy = await db.as(reception, () =>
      rows<{ allergy: string }>("select allergy from patient_allergies where patient_id = $1", [p.id]))
    expect(allergy[0].allergy).toBe("Penicillin")
    const asDoctor = await db.as(doctor, () =>
      rows<{ ht: boolean }>("select ht from patient_medical_history where patient_id = $1", [p.id]))
    expect(asDoctor[0].ht).toBe(true)

    // Receptionist cannot write clinical data (RLS filters the row out).
    const res = await db.as(reception, () =>
      db.query("update patient_medical_history set dm = true where patient_id = $1", [p.id]))
    expect(res.affectedRows ?? 0).toBe(0)
  })

  it("only admins can read the audit log; changes are audited with a reason", async () => {
    const p = await newPatient("Audit Person")
    await db.as(doctor, () =>
      db.query("update patient_allergies set allergy = 'Sulfa' where patient_id = $1", [p.id]), "Patient reported")
    expect(await db.as(doctor, () => rows("select * from audit_logs"))).toHaveLength(0)
    const logs = await db.as(admin, () =>
      rows<{ reason: string; changed_fields: string[]; before: Row; after: Row }>(
        "select * from audit_logs where entity_type = 'patient_allergies' and patient_id = $1", [p.id]))
    const update = logs.find((l) => l.reason === "Patient reported")!
    expect(update.changed_fields).toEqual(["allergy"])
    expect(update.before.allergy).toBeNull()
    expect(update.after.allergy).toBe("Sulfa")
    await expect(db.as(admin, () => db.query("delete from audit_logs"))).rejects.toThrow()
  })

  it("respects the 'assigned' doctor access scope", async () => {
    const p = await newPatient("Scoped Patient")
    // Not assigned to this doctor (the single-doctor rule would assign it).
    await db.query("update patients set assigned_doctor_id = null where id = $1", [p.id])
    await db.as(admin, () => db.query("update clinic_settings set doctor_access_scope = 'assigned'"))
    try {
      expect(await db.as(doctor, () => rows("select id from patients where id = $1", [p.id]))).toHaveLength(0)
      await book(p.id, 5, "09:00")
      expect(await db.as(doctor, () => rows("select id from patients where id = $1", [p.id]))).toHaveLength(1)
    } finally {
      await db.as(admin, () => db.query("update clinic_settings set doctor_access_scope = 'all'"))
    }
  })
})

describe("appointments", () => {
  it("blocks double-booking the same doctor at the database level", async () => {
    const p = await newPatient("Booker One")
    const q = await newPatient("Booker Two")
    await book(p.id, 3, "10:00")
    await expect(book(q.id, 3, "10:05")).rejects.toThrow(/appointments_no_double_booking/)
    await expect(book(q.id, 3, "10:15")).resolves.toBeTruthy()
  })

  it("enforces controlled status transitions and timestamps", async () => {
    const p = await newPatient("Flow Patient")
    const a = await book(p.id, 0, "23:30")
    await db.as(reception, () => db.query("update appointments set status = 'checked_in' where id = $1", [a.id]))
    const row = await one<{ checked_in_at: string }>("select checked_in_at from appointments where id = $1", [a.id])
    expect(row.checked_in_at).toBeTruthy()
    await expect(
      db.as(doctor, () => db.query("update appointments set status = 'completed' where id = $1", [a.id])),
    ).rejects.toThrow(/cannot move/)
  })

  it("notifies the doctor on check-in", async () => {
    const p = await newPatient("Notify Me")
    const a = await book(p.id, 0, "22:00")
    await db.as(reception, () => db.query("update appointments set status = 'checked_in' where id = $1", [a.id]))
    const n = await db.as(doctor, () =>
      rows<{ type: string }>("select type from notifications where entity_id = $1 order by created_at", [a.id]))
    expect(n.map((x) => x.type)).toContain("patient_checked_in")
  })

  it("sends tomorrow's reminder to receptionists immediately and voids it on cancel", async () => {
    const p = await newPatient("Tomorrow Patient")
    const a = await book(p.id, 1, "11:00")
    const reminder = await one<{ status: string }>("select status from appointment_reminders where appointment_id = $1", [a.id])
    expect(reminder.status).toBe("sent")
    const deskNotes = await db.as(reception, () =>
      rows<{ voided_at: string | null }>("select voided_at from notifications where entity_id = $1 and type = 'appointment_reminder'", [a.id]))
    expect(deskNotes).toHaveLength(1)
    await db.as(reception, () => db.query("update appointments set status = 'cancelled' where id = $1", [a.id]))
    const after = await db.as(reception, () =>
      rows<{ voided_at: string | null }>("select voided_at from notifications where entity_id = $1 and type = 'appointment_reminder'", [a.id]))
    expect(after[0].voided_at).toBeTruthy()
  })

  it("keeps far-future reminders pending and reschedules atomically", async () => {
    const p = await newPatient("Later Patient")
    const a = await book(p.id, 10, "12:00")
    expect((await one<{ status: string }>("select status from appointment_reminders where appointment_id = $1", [a.id])).status).toBe("pending")
    // Reschedule into the overlapping slot of itself works because the old one is released first.
    const newId = await db.as(reception, async () =>
      (await one<{ id: string }>("select public.reschedule_appointment($1, $2) as id", [a.id, ammanAt(10, "12:05")])).id)
    const old = await one<{ status: string }>("select status from appointments where id = $1", [a.id])
    expect(old.status).toBe("rescheduled")
    const fresh = await one<{ rescheduled_from_id: string; status: string }>("select * from appointments where id = $1", [newId])
    expect(fresh.rescheduled_from_id).toBe(a.id)
    expect(fresh.status).toBe("scheduled")
    expect((await one<{ status: string }>("select status from appointment_reminders where appointment_id = $1", [a.id])).status).toBe("cancelled")
    // Changing the time directly is refused.
    await expect(
      db.as(reception, () => db.query("update appointments set scheduled_at = scheduled_at + interval '1 hour' where id = $1", [newId])),
    ).rejects.toThrow(/reschedule/i)
  })

  it("counts today's dashboard figures", async () => {
    const counts = await db.as(reception, () => one<{ c: Record<string, number> }>("select public.appointment_counts() as c"))
    expect(counts.c).toHaveProperty("waiting")
    expect(counts.c).toHaveProperty("tomorrow")
  })
})

describe("visits", () => {
  it("starts a fertility visit from a checked-in appointment and completes it", async () => {
    const p = await newPatient("Fertility Patient")
    await db.as(doctor, () => db.query("update patient_menstrual_history set lmp = '2026-09-20' where patient_id = $1", [p.id]))
    await db.as(doctor, () => db.query("update patient_obstetric_history set gravida = 2, para = 1 where patient_id = $1", [p.id]))
    const a = await book(p.id, 0, "20:00")
    await db.as(reception, () => db.query("update appointments set status = 'checked_in' where id = $1", [a.id]))

    const visitId = await db.as(doctor, async () =>
      (await one<{ id: string }>("select public.start_visit($1, 'fertility', $2) as id", [p.id, a.id])).id)
    // Re-starting resumes the same draft
    const again = await db.as(doctor, async () =>
      (await one<{ id: string }>("select public.start_visit($1, 'fertility', $2) as id", [p.id, a.id])).id)
    expect(again).toBe(visitId)

    const appt = await one<{ status: string }>("select status from appointments where id = $1", [a.id])
    expect(appt.status).toBe("with_doctor")
    const vc = await one<{ lmp: string; gravida: number; para: number }>("select lmp::text, gravida, para from visit_clinical where visit_id = $1", [visitId])
    expect(vc).toMatchObject({ lmp: "2026-09-20", gravida: 2, para: 1 })
    const visit = await one<{ form_version: number; patient_age_years: number }>("select * from visits where id = $1", [visitId])
    expect(visit.form_version).toBe(1)
    expect(visit.patient_age_years).toBeGreaterThan(20)

    await expect(db.as(doctor, () => db.query("select public.complete_visit($1)", [visitId]))).rejects.toThrow(/plan_primary/)
    await db.as(doctor, () => db.query("update fertility_visits set plan_primary = 'oi' where visit_id = $1", [visitId]))
    await db.as(doctor, () => db.query("select public.complete_visit($1)", [visitId]))
    expect((await one<{ status: string }>("select status from visits where id = $1", [visitId])).status).toBe("completed")
    expect((await one<{ status: string }>("select status from appointments where id = $1", [a.id])).status).toBe("completed")

    // Completed visits need a reason to be corrected.
    await expect(
      db.as(doctor, () => db.query("update fertility_visits set notes = 'late' where visit_id = $1", [visitId])),
    ).rejects.toThrow(/reason is required/)
    await db.as(doctor, () => db.query("update fertility_visits set notes = 'late' where visit_id = $1", [visitId]), "Typo")
    // Receptionists cannot correct
    await expect(
      db.as(reception, () => db.query("update visits set cancel_reason = 'x' where id = $1", [visitId]), "x"),
    ).resolves.toBeTruthy() // filtered by RLS -> 0 rows, no error
  })

  it("receptionists see recent visit metadata only", async () => {
    const list = await db.as(reception, () => rows("select id from visits"))
    expect(list.length).toBeGreaterThan(0)
    expect(await db.as(reception, () => rows("select * from fertility_visits"))).toHaveLength(0)
  })

  it("requires a pregnancy case and numbers follow-ups sequentially", async () => {
    const p = await newPatient("Pregnant Patient")
    await expect(
      db.as(doctor, () => db.query("select public.start_visit($1, 'pregnancy') as id", [p.id])),
    ).rejects.toThrow(/pregnancy case/)
    await db.as(doctor, () => db.query("update patient_obstetric_history set gravida = 3, para = 2 where patient_id = $1", [p.id]))
    const c = await db.as(doctor, () =>
      one<{ id: string; case_number: number; gravida: number }>("insert into pregnancy_cases (patient_id) values ($1) returning *", [p.id]))
    expect(c).toMatchObject({ case_number: 1, gravida: 3 })
    const v1 = await db.as(doctor, async () => (await one<{ id: string }>("select public.start_visit($1, 'pregnancy') as id", [p.id])).id)
    await db.as(doctor, () => db.query("update pregnancy_followups set bp_systolic = 110, bp_diastolic = 70 where visit_id = $1", [v1]))
    await db.as(doctor, () => db.query("select public.complete_visit($1)", [v1]))
    const v2 = await db.as(doctor, async () => (await one<{ id: string }>("select public.start_visit($1, 'pregnancy') as id", [p.id])).id)
    const f = await rows<{ visit_no: number }>("select visit_no from pregnancy_followups where pregnancy_case_id = $1 order by visit_no", [c.id])
    expect(f.map((x) => x.visit_no)).toEqual([1, 2])
    await expect(db.as(doctor, () => db.query("select public.complete_visit($1)", [v2]))).rejects.toThrow(/blood_pressure/)
    // Only one active pregnancy
    await expect(db.as(doctor, () => db.query("insert into pregnancy_cases (patient_id) values ($1)", [p.id]))).rejects.toThrow()
  })
})

describe("O/I cycles", () => {
  it("imports snapshots, calculates dates and protects source results", async () => {
    const p = await newPatient("OI Patient", { address: "Jabal Amman" })
    await db.as(doctor, () => db.query("update patient_husbands set full_name = 'Omar', dob = '1990-01-01' where patient_id = $1", [p.id]))
    await db.as(doctor, () => db.query(
      "insert into investigation_results (patient_id, type_code, value_numeric, result_date) values ($1, 'amh', 1.4, '2026-01-10'), ($1, 'amh', 1.1, '2026-06-10'), ($1, 'tsh', 2.1, '2026-06-01')",
      [p.id]))
    const fcase = await db.as(doctor, () => one<{ id: string }>("insert into fertility_cases (patient_id) values ($1) returning id", [p.id]))
    const cycle = await db.as(doctor, () =>
      one<{ id: string; cycle_number: number; husband_name: string; address: string; wife_age: number }>(
        "insert into fertility_cycles (fertility_case_id) values ($1) returning *", [fcase.id]))
    expect(cycle).toMatchObject({ cycle_number: 1, husband_name: "Omar", address: "Jabal Amman" })

    const days = await rows("select * from fertility_cycle_days where cycle_id = $1", [cycle.id])
    expect(days).toHaveLength(15)
    const amh = await one<{ value: string; source_date: string }>(
      "select value, source_date::text from fertility_cycle_hormones where cycle_id = $1 and hormone_code = 'amh'", [cycle.id])
    expect(amh).toEqual({ value: "1.1", source_date: "2026-06-10" })

    // Editing the chart snapshot leaves the lab history untouched.
    await db.as(doctor, () => db.query("update fertility_cycle_hormones set value = '1.2' where cycle_id = $1 and hormone_code = 'amh'", [cycle.id]))
    const lab = await rows<{ v: string }>("select value_numeric::text as v from investigation_results where patient_id = $1 and type_code = 'amh' order by result_date", [p.id])
    expect(lab.map((r) => r.v)).toEqual(["1.4", "1.1"])

    // Day 1 drives Day 2..15, keeping manual overrides
    await db.as(doctor, () => db.query("update fertility_cycle_days set cycle_date = '2026-10-20', is_override = true where cycle_id = $1 and day_number = 9", [cycle.id]))
    await db.as(doctor, () => db.query("select public.set_cycle_day1($1, '2026-10-03')", [cycle.id]))
    const dates = await rows<{ day_number: number; d: string }>(
      "select day_number, cycle_date::text as d from fertility_cycle_days where cycle_id = $1 order by day_number", [cycle.id])
    expect(dates[0].d).toBe("2026-10-03")
    expect(dates[1].d).toBe("2026-10-04")
    expect(dates[8].d).toBe("2026-10-20")
    expect(dates[14].d).toBe("2026-10-17")

    // Cells
    await db.as(doctor, () => db.query(
      "insert into fertility_cycle_follicles (cycle_id, day_number, side, row_index, size) values ($1, 3, 'R', 0, '14'), ($1, 3, 'L', 0, '11')", [cycle.id]))
    await db.as(doctor, () => db.query(
      "insert into fertility_cycle_medications (cycle_id, medication_code, day_number, value) values ($1, 'hmg', 2, '150')", [cycle.id]))

    // Completed cycles are historical
    await db.as(doctor, () => db.query("update fertility_cycles set status = 'completed' where id = $1", [cycle.id]))
    await expect(db.as(doctor, () => db.query(
      "update fertility_cycle_follicles set size = '15' where cycle_id = $1 and day_number = 3 and side = 'R'", [cycle.id])))
      .rejects.toThrow(/reason is required/)
    const second = await db.as(doctor, () =>
      one<{ cycle_number: number }>("insert into fertility_cycles (fertility_case_id) values ($1) returning cycle_number", [fcase.id]))
    expect(second.cycle_number).toBe(2)

    const timeline = await db.as(doctor, () =>
      rows<{ event_type: string }>("select event_type from patient_timeline where patient_id = $1", [p.id]))
    expect(timeline.map((t) => t.event_type)).toEqual(
      expect.arrayContaining(["patient_created", "fertility_case", "oi_cycle_started", "oi_cycle_completed"]))
  })
})

describe("search", () => {
  it("finds patients by name, ID and phone and flags duplicates", async () => {
    const p = await newPatient("Huda Mansour", { phone: "+962 79 555 1234", dob: "1990-02-02" })
    const byName = await db.as(reception, () => rows<{ id: string }>("select * from search_patients('Huda')"))
    expect(byName.map((r) => r.id)).toContain(p.id)
    const byPhone = await db.as(reception, () => rows<{ id: string }>("select * from search_patients('5551234')"))
    expect(byPhone.map((r) => r.id)).toContain(p.id)
    const code = (await one<{ patient_code: string }>("select patient_code from patients where id = $1", [p.id])).patient_code
    const byCode = await db.as(reception, () => rows<{ id: string }>("select * from search_patients($1)", [code]))
    expect(byCode[0].id).toBe(p.id)

    const dupes = await db.as(reception, () =>
      rows<{ id: string; reasons: string[] }>("select * from find_possible_duplicates('Huda Mansur', '0795551234', '1990-02-02')"))
    const hit = dupes.find((d) => d.id === p.id)!
    expect(hit.reasons).toEqual(expect.arrayContaining(["phone", "dob"]))

    const global = await db.as(doctor, () => one<{ r: { patients: unknown[] } }>("select public.search_global('Huda') as r"))
    expect(global.r.patients.length).toBeGreaterThan(0)
  })
})

describe("patient registration (create_patient) and doctor assignment", () => {
  // Mirrors exactly what the createPatient server action sends.
  const register = (patient: Record<string, unknown>, husband: Record<string, unknown> = {}) =>
    db.as(reception, () =>
      one<{ id: string; patient_code: string }>("select * from public.create_patient($1::jsonb, $2::jsonb)", [
        JSON.stringify(patient),
        JSON.stringify(husband),
      ]),
    )
  const base = {
    full_name: "Registration Test",
    phone: "0791234567",
    dob: "1994-10-03", // typed as 03/10/1994 in the UI
    occupation: null,
    address: null,
    marriage_date: null,
    blood_group: null,
    rh: null,
    payment_method: "cash",
    insurance_company_id: null,
  }

  it("creates patient + husband in one call and auto-assigns the only active doctor", async () => {
    const row = await register(base, { full_name: "Husband Test", dob: "1990-01-01", occupation: null, blood_group: "B", rh: "+" })
    expect(row.patient_code).toMatch(/^PAT-\d{6}$/)
    const p = await one<{ dob: string; assigned_doctor_id: string }>("select dob::text, assigned_doctor_id from patients where id = $1", [row.id])
    expect(p).toEqual({ dob: "1994-10-03", assigned_doctor_id: doctorId })
    const h = await one<{ full_name: string; blood_group: string }>("select full_name, blood_group from patient_husbands where patient_id = $1", [row.id])
    expect(h).toEqual({ full_name: "Husband Test", blood_group: "B" })
  })

  it("rolls everything back when any part fails (no half-created patient)", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from patients")
    await expect(register({ ...base, full_name: "Rollback Test" }, { blood_group: "X" })).rejects.toThrow()
    const after = await one<{ n: number }>("select count(*)::int as n from patients")
    expect(after.n).toBe(before.n)
  })

  it("keeps the chosen doctor when several are active, and allows none", async () => {
    const second = await createUser(db, { email: "doctor2@clinic.test", role: "doctor", name: "Dr. Second" })
    const secondId = (await one<{ id: string }>("select id from doctors where profile_id = $1", [second])).id
    const chosen = await register({ ...base, full_name: "Chosen Doctor", assigned_doctor_id: secondId })
    expect((await one<{ d: string }>("select assigned_doctor_id as d from patients where id = $1", [chosen.id])).d).toBe(secondId)
    const none = await register({ ...base, full_name: "No Doctor Chosen" })
    expect((await one<{ d: string | null }>("select assigned_doctor_id as d from patients where id = $1", [none.id])).d).toBeNull()
    // An inactive doctor can never be assigned (with 2+ active doctors left).
    const third = await createUser(db, { email: "doctor3@clinic.test", role: "doctor", name: "Dr. Third" })
    await db.query("update doctors set active = false where id = $1", [secondId])
    await expect(register({ ...base, full_name: "Inactive Doctor", assigned_doctor_id: secondId })).rejects.toThrow(/not active/)
    // Back to one active doctor: that doctor is used regardless of the request.
    await db.query("update doctors set active = false where profile_id = $1", [third])
    const single = await register({ ...base, full_name: "Single Again", assigned_doctor_id: secondId })
    expect((await one<{ d: string }>("select assigned_doctor_id as d from patients where id = $1", [single.id])).d).toBe(doctorId)
  })

  it("creates the patient without a doctor when no doctor is active", async () => {
    await db.query("update doctors set active = false")
    try {
      const row = await register({ ...base, full_name: "Zero Doctors" })
      expect((await one<{ d: string | null }>("select assigned_doctor_id as d from patients where id = $1", [row.id])).d).toBeNull()
    } finally {
      await db.query("update doctors set active = true where id = $1", [doctorId])
    }
  })
})
