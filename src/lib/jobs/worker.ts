import "server-only"
import { createTranslator } from "next-intl"
import en from "../../../messages/en.json"
import ar from "../../../messages/ar.json"
import { createAdminClient } from "@/lib/supabase/admin"
import { clinicInfo, renderEmail, sendEmail, templateForPurpose } from "@/lib/email/send"
import { appointmentVariables, messageDate, messageTime, type AppointmentPayload } from "@/lib/messaging/variables"
import { firstName, type TemplateVars } from "@/lib/messaging/templates"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"

/**
 * Background jobs, safe to run concurrently on several instances: every
 * unit of work is claimed atomically in the database (SKIP LOCKED).
 *   1. appointment reminder rules (in-app / WhatsApp-ready / email)
 *   2. email outbox (notification emails, security alerts) with retries
 *   3. retention of generated documents (file removed, metadata kept)
 *   4. security housekeeping
 */
// Each failing step is logged once (e.g. before `supabase db push` was run), not every minute.
const reported = new Set<string>()
function reportOnce(step: string, code: string | undefined) {
  const key = `${step}:${code ?? "?"}`
  if (reported.has(key)) return
  reported.add(key)
  console.error(`[jobs] ${step} failed: ${code ?? "unknown"}${code === "PGRST202" ? " — apply database migrations: npx supabase db push" : ""}`)
}

export async function runJobs(): Promise<Record<string, number>> {
  const admin = createAdminClient()
  const result: Record<string, number> = {}

  const { data: queued, error: qErr } = await admin.rpc("queue_due_appointment_reminders")
  if (qErr) reportOnce("reminder rules", qErr.code)
  result.reminders = Number(queued ?? 0)

  const { data: legacy } = await admin.rpc("process_due_reminders")
  result.tomorrow = Number(legacy ?? 0)

  result.reminderEmails = await processReminderEmails()
  result.outbox = await processOutbox()
  result.expiredDocuments = await expireDocuments()
  await admin.rpc("security_housekeeping")
  return result
}

type LooseTranslator = { (key: string, values?: Record<string, string | number>): string; has(key: string): boolean }
const translators = {
  en: createTranslator({ locale: "en", messages: en, namespace: "notifications" }) as unknown as LooseTranslator,
  ar: createTranslator({ locale: "ar", messages: ar, namespace: "notifications" }) as unknown as LooseTranslator,
}

function reminderPurpose(visitType: string | undefined) {
  if (visitType === "pregnancy") return "pregnancy_followup_reminder"
  if (visitType === "fertility" || visitType === "oi_followup") return "fertility_followup_reminder"
  return "appointment_reminder"
}

async function processReminderEmails(): Promise<number> {
  const admin = createAdminClient()
  const { data: claimed, error } = await admin.rpc("claim_reminder_emails", { p_limit: 25 })
  if (error) {
    reportOnce("claim reminder emails", error.code)
    return 0
  }
  let n = 0
  for (const row of (claimed ?? []) as {
    delivery_id: string
    appointment_id: string
    patient_id: string
    patient_email: string | null
    patient_language: string | null
    payload: AppointmentPayload & { visit_type?: string }
  }[]) {
    const language = row.patient_language === "en" ? "en" : "ar"
    if (!row.patient_email) {
      await admin
        .from("appointment_reminder_deliveries")
        .update({ status: "skipped", reason: "no_email", processed_at: new Date().toISOString() })
        .eq("id", row.delivery_id)
      continue
    }
    const purpose = reminderPurpose(row.payload.visit_type)
    const template = (await templateForPurpose("email", purpose)) ?? (await templateForPurpose("email", "appointment_reminder"))
    const clinic = await clinicInfo(language)
    const vars: TemplateVars = {
      clinic_name: clinic.name,
      clinic_phone: clinic.phone,
      clinic_address: clinic.address,
      ...appointmentVariables(row.payload, language),
    }
    if (!template) {
      await admin.from("appointment_reminder_deliveries").update({ status: "failed", reason: "no_template", processed_at: new Date().toISOString() }).eq("id", row.delivery_id)
      continue
    }
    const { subject, text } = renderEmail(template, language, vars)
    const { data: log } = await admin
      .from("communication_logs")
      .insert({
        patient_id: row.patient_id,
        appointment_id: row.appointment_id,
        channel: "email",
        purpose,
        template_id: template.id,
        template_version: template.version,
        recipient_type: "patient",
        recipient: row.patient_email,
        language,
        subject,
        body: text,
        status: "queued",
        automated: true,
      })
      .select("id")
      .single()
    const sent = await sendEmail({ to: row.patient_email, subject, text, language }, clinic.name)
    const now = new Date().toISOString()
    if (log) {
      await admin
        .from("communication_logs")
        .update(sent.ok ? { status: "sent", sent_at: now } : { status: "failed", error_code: sent.code })
        .eq("id", log.id)
    }
    await admin
      .from("appointment_reminder_deliveries")
      .update({
        status: sent.ok ? "sent" : "failed",
        reason: sent.ok ? null : sent.code,
        processed_at: now,
        communication_log_id: log?.id ?? null,
      })
      .eq("id", row.delivery_id)
    if (!sent.ok && sent.code !== "not_configured") await reportEmailFailure(sent.code)
    n++
  }
  return n
}

const SECURITY_TYPES = new Set(["new_login", "login_failed", "password_changed", "session_revoked", "security_config_changed"])

async function processOutbox(): Promise<number> {
  const admin = createAdminClient()
  const { data: rows, error } = await admin.rpc("claim_email_outbox", { p_limit: 25 })
  if (error) {
    reportOnce("claim outbox", error.code)
    return 0
  }
  const base = process.env.APP_URL?.replace(/\/+$/, "") ?? ""
  let n = 0
  for (const row of (rows ?? []) as {
    id: string
    purpose: string
    to_address: string
    locale: string
    attempts: number
    variables: { type?: string; title?: string; message?: string; link?: string; data?: Record<string, unknown> }
  }[]) {
    const language = row.locale === "ar" ? "ar" : "en"
    const clinic = await clinicInfo(language)
    const v = row.variables ?? {}
    const type = v.type ?? "system"
    const tr = translators[language]
    const d = (v.data ?? {}) as AppointmentPayload & Record<string, unknown>
    const known = tr.has(`types.${type}.title`) && type !== "system"
    const values = {
      patient: d.patient_name ?? "",
      code: d.patient_code ?? "",
      time: d.scheduled_at ? messageTime(d.scheduled_at, language) : "",
      when: d.scheduled_at ? `${messageDate(d.scheduled_at)} ${messageTime(d.scheduled_at, language)}` : "",
      doctor: (language === "ar" ? d.doctor_name_ar : d.doctor_name_en) ?? "",
      visit: (language === "ar" ? d.visit_type_ar : d.visit_type_en) ?? "",
      device: [d.browser, d.os].filter(Boolean).join(" / ") || (v.message ?? ""),
      hours: 0,
      minutes: Number(d.offset_minutes ?? 0),
      detail: v.message ?? "",
    }
    const title = known ? tr(`types.${type}.title`, values) : (v.title ?? "")
    const message = known ? tr(`types.${type}.body`, values) : (v.message ?? "")
    const purpose = type === "new_login" ? "new_login_alert" : SECURITY_TYPES.has(type) ? "security_alert" : "notification"
    const template = await templateForPurpose("email", purpose)
    const vars: TemplateVars = {
      clinic_name: clinic.name,
      clinic_phone: clinic.phone,
      clinic_address: clinic.address,
      notification_title: title,
      notification_message: message,
      link: base && v.link ? `${base}${v.link}` : base,
      user_email: row.to_address,
      user_name: firstName(row.to_address.split("@")[0]),
      device: values.device,
      login_time: `${messageDate(new Date().toISOString())} ${messageTime(new Date().toISOString(), language)}`,
    }
    const rendered = template ? renderEmail(template, language, vars) : { subject: title, text: `${title}\n\n${message}` }
    const sent = await sendEmail({ to: row.to_address, subject: rendered.subject, text: rendered.text, language }, clinic.name)
    if (sent.ok) {
      await admin.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id)
    } else {
      const retry = row.attempts < 5 && sent.code !== "not_configured" && sent.code !== "recipient_rejected"
      await admin
        .from("email_outbox")
        .update({
          status: retry ? "queued" : "failed",
          last_error: sent.code,
          next_attempt_at: new Date(Date.now() + 2 ** row.attempts * 60_000).toISOString(),
        })
        .eq("id", row.id)
      if (!retry && sent.code !== "not_configured") await reportEmailFailure(sent.code)
    }
    n++
  }
  return n
}

/** Tell the email administrators — at most once per hour. */
async function reportEmailFailure(code: string) {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("type", "email_failure")
    .gte("created_at", since)
  if ((count ?? 0) > 0) return
  await admin.rpc("notify_permission", {
    p_permission: "settings.email.manage",
    p_type: "email_failure",
    p_title: "Email failure",
    p_message: code,
    p_data: { code },
    p_link: "/admin/email",
  })
}

async function expireDocuments(): Promise<number> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("expire_generated_documents", { p_limit: 50 })
  if (error || !data?.length) return 0
  const paths = (data as { storage_path: string }[]).map((d) => d.storage_path)
  const { error: rmError } = await admin.storage.from(DOCUMENTS_BUCKET).remove(paths)
  if (rmError) console.error(`[jobs] expired files not removed: ${rmError.message}`)
  return paths.length
}
