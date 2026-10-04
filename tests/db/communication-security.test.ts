import { beforeAll, describe, expect, it } from "vitest"
import { createDb, createUser, sessions, type Db } from "./harness"

let db: Db
let admin: string
let doctor: string
let reception: string
let doctorId: string
let artDept: string
let patientId: string

type Row = Record<string, unknown>
const one = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T
const rows = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[]

/** Simulates a brand-new Supabase session (not yet registered). */
async function newAuthSession(userId: string) {
  const id = crypto.randomUUID()
  await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [id, userId])
  return id
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
  patientId = (
    await db.as(reception, () =>
      one<{ id: string }>("insert into patients (full_name, phone) values ('Sara Ahmad', '0791234567') returning id"),
    )
  ).id
}, 120_000)

describe("session gate (OTP enforced in the database)", () => {
  it("denies every permission to an unregistered session", async () => {
    const sid = await newAuthSession(reception)
    const visible = await db.as(reception, () => rows("select id from patients"), undefined, sid)
    expect(visible).toHaveLength(0)
    const can = await db.as(reception, () => one<{ ok: boolean }>("select public.has_permission('patients.view') as ok"), undefined, sid)
    expect(can.ok).toBe(false)
  })

  it("activates immediately when OTP is disabled", async () => {
    const sid = await newAuthSession(reception)
    const res = await db.as(reception, () => one<{ r: { status: string } }>("select public.register_session('dev-a', '1.2.3.4', 'UA', 'Chrome', 'Windows', 'desktop') as r"), undefined, sid)
    expect(res.r.status).toBe("active")
    const visible = await db.as(reception, () => rows("select id from patients"), undefined, sid)
    expect(visible.length).toBeGreaterThan(0)
  })

  it("keeps a session pending (no data) until the code is verified when OTP is required", async () => {
    await db.query("update auth_security_settings set otp_mode = 'every_login', otp_scope = 'all' where id = 1")
    const sid = await newAuthSession(doctor)
    const res = await db.as(doctor, () => one<{ r: { status: string; otp_required: boolean } }>("select public.register_session('dev-b', null, 'UA', 'Edge', 'Windows', 'desktop') as r"), undefined, sid)
    expect(res.r).toMatchObject({ status: "pending_otp", otp_required: true })
    expect(await db.as(doctor, () => rows("select id from patients"), undefined, sid)).toHaveLength(0)
    // A pending user cannot activate their own session through the API.
    await expect(db.as(doctor, () => db.query("update user_sessions set status = 'active' where id = $1", [sid]), undefined, sid)).rejects.toThrow()
    // The server (service role) activates it after a correct code.
    await db.query("update user_sessions set status = 'active', otp_verified_at = now() where id = $1", [sid])
    expect((await db.as(doctor, () => rows("select id from patients"), undefined, sid)).length).toBeGreaterThan(0)
    await db.query("update auth_security_settings set otp_mode = 'disabled' where id = 1")
  })

  it("applies OTP only to selected roles", async () => {
    const doctorRole = (await one<{ id: string }>("select id from roles where code = 'doctor'")).id
    await db.query("update auth_security_settings set otp_mode = 'every_login', otp_scope = 'roles' where id = 1")
    await db.query("insert into otp_role_requirements (role_id) values ($1)", [doctorRole])
    const sd = await newAuthSession(doctor)
    const sr = await newAuthSession(reception)
    const d = await db.as(doctor, () => one<{ r: { status: string } }>("select public.register_session('x', null, '', '', '', '') as r"), undefined, sd)
    const r = await db.as(reception, () => one<{ r: { status: string } }>("select public.register_session('y', null, '', '', '', '') as r"), undefined, sr)
    expect(d.r.status).toBe("pending_otp")
    expect(r.r.status).toBe("active")
    await db.query("delete from otp_role_requirements")
    await db.query("update auth_security_settings set otp_mode = 'disabled', otp_scope = 'all' where id = 1")
  })

  it("skips the code on a trusted device in new-device mode and alerts on new devices", async () => {
    await db.query("update auth_security_settings set otp_mode = 'new_device', otp_scope = 'all' where id = 1")
    await db.query("insert into trusted_devices (user_id, device_hash, expires_at) values ($1, 'trusted-hash', now() + interval '30 days')", [admin])
    const s1 = await newAuthSession(admin)
    const trusted = await db.as(admin, () => one<{ r: { status: string } }>("select public.register_session('trusted-hash', null, '', '', '', '') as r"), undefined, s1)
    expect(trusted.r.status).toBe("active")
    const s2 = await newAuthSession(admin)
    const unknown = await db.as(admin, () => one<{ r: { status: string; new_device: boolean } }>("select public.register_session('other-hash', null, '', 'Firefox', 'Linux', 'desktop') as r"), undefined, s2)
    expect(unknown.r).toMatchObject({ status: "pending_otp", new_device: true })
    await db.query("update auth_security_settings set otp_mode = 'disabled' where id = 1")
  })

  it("revokes sessions: own sessions yes, other users' only with sessions.revoke", async () => {
    const other = await newAuthSession(reception)
    await db.as(reception, () => db.query("select public.register_session('z', null, '', '', '', '')"), undefined, other)
    // Receptionist revokes her other session from her main session.
    await db.as(reception, () => db.query("select public.revoke_session($1)", [other]))
    expect((await one<{ status: string }>("select status from user_sessions where id = $1", [other])).status).toBe("revoked")
    expect(await db.as(reception, () => rows("select id from patients"), undefined, other)).toHaveLength(0)
    // ...but cannot revoke the doctor's session.
    await expect(db.as(reception, () => db.query("select public.revoke_session($1)", [sessions.get(doctor)]))).rejects.toThrow(/Not allowed/)
    // Admin can (and the user gets a security notification).
    const target = await newAuthSession(doctor)
    await db.as(doctor, () => db.query("select public.register_session('q', null, '', '', '', '')"), undefined, target)
    await db.as(admin, () => db.query("select public.revoke_session($1, 'test')", [target]))
    const n = await one<{ n: number }>("select count(*)::int as n from notifications where recipient_id = $1 and type = 'session_revoked'", [doctor])
    expect(n.n).toBe(1)
    const ev = await one<{ n: number }>("select count(*)::int as n from security_events where event_type = 'session.revoked'")
    expect(ev.n).toBeGreaterThanOrEqual(2)
  })

  it("keeps login and security logs append-only", async () => {
    await db.query("insert into login_events (event, email) values ('login_failed', 'x@y.z')")
    await expect(db.query("update login_events set email = 'a@b.c'")).rejects.toThrow(/immutable/)
    await expect(db.as(admin, () => db.query("insert into login_events (event) values ('logout')"))).rejects.toThrow()
  })

  it("rate limits with a shared counter", async () => {
    const hit = async () => (await one<{ ok: boolean }>("select public.rate_limit_hit('test:key', 3, 60) as ok")).ok
    expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false])
  })
})

describe("notifications engine", () => {
  it("fills category/priority from the catalog and drops disabled events", async () => {
    await db.query("select public.notify_user($1, 'patient_registered', 'x')", [doctor])
    const n = await one<{ category: string; priority: string }>("select category, priority from notifications where recipient_id = $1 and type = 'patient_registered' order by created_at desc limit 1", [doctor])
    expect(n).toMatchObject({ category: "patients", priority: "normal" })
    await db.query("update notification_event_types set in_app_enabled = false where code = 'doctor_added'")
    await db.query("select public.notify_user($1, 'doctor_added', 'x')", [admin])
    expect((await one<{ n: number }>("select count(*)::int as n from notifications where type = 'doctor_added' and title = 'x' and recipient_id = $1", [admin])).n).toBe(0)
  })

  it("never lets a user mute critical security events, and queues email for them", async () => {
    await db.query("insert into user_notification_preferences (user_id, event_code, in_app, email) values ($1, 'login_failed', false, false)", [admin])
    await db.query("select public.notify_user($1, 'login_failed', 'x')", [admin])
    const n = await one<{ priority: string }>("select priority from notifications where recipient_id = $1 and type = 'login_failed'", [admin])
    expect(n.priority).toBe("critical")
    const mail = await one<{ n: number }>("select count(*)::int as n from email_outbox where to_address = 'admin@clinic.test'")
    expect(mail.n).toBeGreaterThan(0)
  })

  it("notifies the assigned doctor about new patients without clinical details", async () => {
    const p = await db.as(reception, () => one<{ id: string }>("insert into patients (full_name) values ('Lina Khalil') returning id"))
    const n = await one<{ title: string; message: string; link: string }>("select title, message, link from notifications where recipient_id = $1 and type = 'patient_registered' and patient_id = $2", [doctor, p.id])
    expect(n.link).toBe(`/patients/${p.id}`)
    expect(n.message).toMatch(/Lina Khalil — PAT-/)
  })

  it("lets users read only their own notifications", async () => {
    const mine = await db.as(reception, () => rows<{ recipient_id: string }>("select recipient_id from notifications"))
    expect(mine.every((r) => r.recipient_id === reception)).toBe(true)
  })
})

describe("message templates", () => {
  it("seeds built-in Arabic + English templates for email and WhatsApp", async () => {
    const r = await one<{ email: number; wa: number }>("select count(*) filter (where channel = 'email')::int as email, count(*) filter (where channel = 'whatsapp')::int as wa from message_templates where is_system")
    expect(r.email).toBeGreaterThanOrEqual(15)
    expect(r.wa).toBeGreaterThanOrEqual(11)
    const wa = await one<{ body_ar: string }>("select body_ar from message_templates where code = 'wa_appointment_reminder'")
    expect(wa.body_ar).toContain("{{doctor_name}}")
  })

  it("keeps every version and restores old ones as a new version", async () => {
    const id = (await one<{ id: string }>("select id from message_templates where code = 'wa_birthday'")).id
    await db.as(admin, () => db.query("update message_templates set body_ar = 'نص جديد' where id = $1", [id]))
    const versions = await rows<{ id: string; version_no: number; body_ar: string }>("select id, version_no, body_ar from message_template_versions where template_id = $1 order by version_no", [id])
    expect(versions.map((v) => v.version_no)).toEqual([1, 2])
    await db.as(admin, () => db.query("select public.restore_message_template_version($1)", [versions[0].id]))
    const restored = await one<{ body_ar: string }>("select body_ar from message_templates where id = $1", [id])
    expect(restored.body_ar).toBe(versions[0].body_ar)
    expect((await one<{ n: number }>("select count(*)::int as n from message_template_versions where template_id = $1", [id])).n).toBe(3)
  })

  it("protects built-ins and checks permissions", async () => {
    const id = (await one<{ id: string }>("select id from message_templates where code = 'email_welcome'")).id
    await expect(db.as(admin, () => db.query("update message_templates set archived_at = now() where id = $1", [id]))).rejects.toThrow(/Built-in/)
    await expect(
      db.as(reception, () => db.query("insert into message_templates (channel, category, name_en, name_ar, body_ar) values ('whatsapp', 'custom', 'x', 'x', 'x')")),
    ).rejects.toThrow()
    await expect(db.as(admin, () => db.query("update message_templates set subject_en = E'a\\nBcc: evil@x.com' where id = $1", [id]))).rejects.toThrow()
  })
})

describe("communication log & email credentials", () => {
  it("never records WhatsApp as delivered and only lets the user mark it opened", async () => {
    const log = await db.as(reception, () =>
      one<{ id: string }>(
        "insert into communication_logs (patient_id, channel, recipient, body, status, performed_by) values ($1, 'whatsapp', '+962791234567', 'hi', 'prepared', $2) returning id",
        [patientId, reception],
      ),
    )
    await expect(db.query("update communication_logs set status = 'sent' where id = $1", [log.id])).rejects.toThrow()
    await expect(db.as(reception, () => db.query("update communication_logs set body = 'changed' where id = $1", [log.id]))).rejects.toThrow(/cannot be changed/)
    await db.as(reception, () => db.query("update communication_logs set status = 'opened' where id = $1", [log.id]))
    expect((await one<{ status: string; opened_at: string }>("select status, opened_at from communication_logs where id = $1", [log.id])).opened_at).toBeTruthy()
    await expect(
      db.as(reception, () =>
        db.query("insert into communication_logs (patient_id, channel, recipient, body, status, performed_by) values ($1, 'whatsapp', '+1', 'x', 'opened', $2)", [patientId, doctor]),
      ),
    ).rejects.toThrow()
  })

  it("never exposes encrypted SMTP/IMAP passwords to signed-in users", async () => {
    await db.query(
      "insert into email_accounts (email_address, display_name, smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_enc) values ('clinic@example.com', 'Clinic', 'smtp.example.com', 587, 'tls', 'clinic', 'v1:xx:yy:zz')",
    )
    const safe = await db.as(admin, () => one<{ email_address: string }>("select email_address, smtp_status from email_accounts"))
    expect(safe.email_address).toBe("clinic@example.com")
    await expect(db.as(admin, () => db.query("select smtp_password_enc from email_accounts"))).rejects.toThrow(/permission denied/)
    await expect(db.as(admin, () => db.query("update email_accounts set smtp_host = 'evil.com'"))).rejects.toThrow(/permission denied/)
    expect(await db.as(reception, () => rows("select id from email_accounts"))).toHaveLength(0)
  })
})

describe("generated documents", () => {
  const pathFor = (pid: string) => `${pid}/generated/2026/10/${crypto.randomUUID()}.pdf`

  it("versions immutable snapshots and only allows soft deletion with permission", async () => {
    const insert = (by: string) =>
      db.as(by, () =>
        one<{ id: string; version_no: number }>(
          `insert into generated_documents (patient_id, document_type, title, file_name, storage_path, size_bytes, sha256, language, orientation, source_entity_type, source_entity_id, generated_by)
           values ($1, 'patient_summary', 'Patient Summary', 'Sara_Ahmad_Patient_Summary_2026-10-03_19-45.pdf', $2, 1000, $3, 'ar', 'portrait', 'patient', $1, $4) returning id, version_no`,
          [patientId, pathFor(patientId), "a".repeat(64), by],
        ),
      )
    const v1 = await insert(reception)
    const v2 = await insert(doctor)
    expect([v1.version_no, v2.version_no]).toEqual([1, 2])
    await expect(db.as(admin, () => db.query("update generated_documents set file_name = 'x.pdf' where id = $1", [v1.id]))).rejects.toThrow(/immutable/)
    await expect(db.as(reception, () => db.query("update generated_documents set status = 'deleted' where id = $1", [v1.id]))).resolves.toMatchObject({ affectedRows: 0 })
    await db.as(admin, () => db.query("update generated_documents set status = 'deleted' where id = $1", [v1.id]))
    expect((await one<{ deleted_by: string }>("select deleted_by from generated_documents where id = $1", [v1.id])).deleted_by).toBe(admin)
  })

  it("rejects storage paths outside the patient's folder", async () => {
    const other = await db.as(reception, () => one<{ id: string }>("insert into patients (full_name) values ('Other Patient') returning id"))
    await expect(
      db.as(reception, () =>
        db.query(
          `insert into generated_documents (patient_id, document_type, title, file_name, storage_path, size_bytes, sha256, language, orientation, generated_by)
           values ($1, 'timeline', 't', 'f.pdf', $2, 10, $3, 'en', 'portrait', $4)`,
          [patientId, pathFor(other.id), "b".repeat(64), reception],
        ),
      ),
    ).rejects.toThrow()
  })

  it("prevents logging access to documents the user cannot see (IDOR)", async () => {
    const doc = await one<{ id: string }>("select id from generated_documents where status = 'generated' and generated_by = $1 limit 1", [doctor])
    // Receptionists have no documents.view: a document generated by someone else is invisible.
    await expect(db.as(reception, () => db.query("select public.log_document_access($1, null, 'viewed')", [doc.id]))).rejects.toThrow(/not found/)
    await db.as(doctor, () => db.query("select public.log_document_access($1, null, 'downloaded')", [doc.id]))
    expect((await one<{ n: number }>("select count(*)::int as n from document_access_logs where generated_document_id = $1", [doc.id])).n).toBe(1)
  })
})

describe("appointment reminder engine", () => {
  it("fires only the latest due threshold once, and skips thresholds before the booking", async () => {
    await db.query("update reminder_rules set enabled = (channel = 'in_app' and offset_minutes in (60, 120))")
    const soon = new Date(Date.now() + 30 * 60_000).toISOString()
    const appt = await one<{ id: string }>(
      `insert into appointments (patient_id, doctor_id, department_id, visit_type, scheduled_at, created_at)
       values ($1, $2, $3, 'fertility', $4, now() - interval '2 days') returning id`,
      [patientId, doctorId, artDept, soon],
    )
    await db.query("select public.queue_due_appointment_reminders()")
    await db.query("select public.queue_due_appointment_reminders()")
    const deliveries = await rows<{ status: string; offset_minutes: number }>(
      "select d.status, r.offset_minutes from appointment_reminder_deliveries d join reminder_rules r on r.id = d.rule_id where d.appointment_id = $1 order by r.offset_minutes",
      [appt.id],
    )
    expect(deliveries).toEqual([
      { status: "sent", offset_minutes: 60 },
      { status: "skipped", offset_minutes: 120 },
    ])
    const n = await one<{ n: number }>("select count(*)::int as n from notifications where entity_id = $1 and type = 'appointment_approaching' and recipient_id = $2", [appt.id, doctor])
    expect(n.n).toBe(1)

    // Booked 10 minutes before: no reminder for a threshold that passed before booking.
    const late = await one<{ id: string }>(
      `insert into appointments (patient_id, doctor_id, department_id, visit_type, scheduled_at)
       values ($1, $2, $3, 'fertility', $4) returning id`,
      [patientId, doctorId, artDept, new Date(Date.now() + 10 * 60_000 + 3 * 3600_000).toISOString()],
    )
    await db.query("select public.queue_due_appointment_reminders()")
    expect((await one<{ n: number }>("select count(*)::int as n from appointment_reminder_deliveries where appointment_id = $1 and status = 'sent'", [late.id])).n).toBe(0)
  })
})
