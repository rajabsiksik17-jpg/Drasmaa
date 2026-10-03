import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { renderTemplate, sanitizeSubject, type TemplateVars } from "@/lib/messaging/templates"
import {
  EmailError,
  classifyEmailError,
  loadEmailAccount,
  logEmailError,
  recordSendOutcome,
  smtpTransport,
  type EmailErrorCode,
} from "./account"

const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/i

export const isValidEmail = (v: string | null | undefined): v is string => !!v && v.length <= 320 && EMAIL_RE.test(v)

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
  language: "ar" | "en"
  attachments?: { filename: string; content: Buffer; contentType: string }[]
}

export type SendResult = { ok: true; messageId: string } | { ok: false; code: EmailErrorCode }

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

/** Simple, well-supported HTML layout (escaped text only — no template HTML). */
export function htmlEmail(text: string, language: "ar" | "en", clinicName: string) {
  const dir = language === "ar" ? "rtl" : "ltr"
  const body = escapeHtml(text).replace(/\r?\n/g, "<br>")
  return `<!doctype html><html lang="${language}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f4f6f8;font-family:Cairo,'Segoe UI',Tahoma,Arial,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e3e8ee">
<tr><td style="padding:18px 24px;border-bottom:1px solid #eef1f4;font-weight:700;font-size:15px;color:#0f766e" dir="${dir}">${escapeHtml(clinicName)}</td></tr>
<tr><td style="padding:22px 24px;font-size:14px;line-height:1.8;text-align:${dir === "rtl" ? "right" : "left"}" dir="${dir}">${body}</td></tr>
</table></td></tr></table></body></html>`
}

/** Sends one email through the configured SMTP account. Never throws. */
export async function sendEmail(mail: OutgoingEmail, clinicName: string): Promise<SendResult> {
  if (!isValidEmail(mail.to)) return { ok: false, code: "recipient_rejected" }
  let account
  try {
    account = await loadEmailAccount()
  } catch (e) {
    return { ok: false, code: classifyEmailError(e) }
  }
  if (!account || !account.smtp_password) return { ok: false, code: "not_configured" }
  try {
    const transport = smtpTransport(account)
    const info = await transport.sendMail({
      from: { name: account.display_name.replace(/[\r\n"]/g, ""), address: account.email_address },
      to: mail.to,
      subject: sanitizeSubject(mail.subject),
      text: mail.text,
      html: htmlEmail(mail.text, mail.language, clinicName),
      attachments: mail.attachments,
      disableFileAccess: true,
      disableUrlAccess: true,
    })
    transport.close()
    await recordSendOutcome(account.id, true)
    return { ok: true, messageId: String(info.messageId ?? "") }
  } catch (e) {
    const code = classifyEmailError(e)
    logEmailError("send", e)
    await recordSendOutcome(account.id, false, code)
    return { ok: false, code }
  }
}

export interface TemplateRow {
  id: string
  version: number
  subject_en: string | null
  subject_ar: string | null
  body_en: string
  body_ar: string
}

/** Active template for a purpose (built-in preferred, then most recent custom). */
export async function templateForPurpose(channel: "email" | "whatsapp", purpose: string): Promise<TemplateRow | null> {
  const { data } = await createAdminClient()
    .from("message_templates")
    .select("id, version, subject_en, subject_ar, body_en, body_ar")
    .eq("channel", channel)
    .eq("purpose", purpose)
    .eq("active", true)
    .is("archived_at", null)
    .order("is_system", { ascending: false })
    .order("sort_order")
    .limit(1)
    .maybeSingle()
  return (data as TemplateRow | null) ?? null
}

export function renderEmail(t: TemplateRow, language: "ar" | "en", vars: TemplateVars) {
  const subject = (language === "ar" ? t.subject_ar || t.subject_en : t.subject_en || t.subject_ar) ?? ""
  const body = language === "ar" ? t.body_ar || t.body_en : t.body_en || t.body_ar
  return { subject: sanitizeSubject(renderTemplate(subject, vars)), text: renderTemplate(body, vars) }
}

export async function clinicInfo(language: "ar" | "en") {
  const { data } = await createAdminClient()
    .from("clinic_settings")
    .select("clinic_name_en, clinic_name_ar, phone, address_en, address_ar, whatsapp_country_code")
    .eq("id", 1)
    .single()
  const ar = language === "ar"
  return {
    name: (ar ? data?.clinic_name_ar : data?.clinic_name_en) || data?.clinic_name_en || "",
    phone: data?.phone ?? "",
    address: (ar ? data?.address_ar : data?.address_en) || data?.address_en || "",
    countryCode: data?.whatsapp_country_code ?? "962",
  }
}

/** Template purpose → rendered + sent. Used by OTP, alerts and reminders. */
export async function sendTemplatedEmail(
  purpose: string,
  to: string,
  language: "ar" | "en",
  vars: TemplateVars,
  fallback: { subject: string; text: string },
): Promise<SendResult> {
  const clinic = await clinicInfo(language)
  const allVars: TemplateVars = { clinic_name: clinic.name, clinic_phone: clinic.phone, clinic_address: clinic.address, ...vars }
  const template = await templateForPurpose("email", purpose)
  const rendered = template ? renderEmail(template, language, allVars) : { subject: fallback.subject, text: fallback.text }
  if (!rendered.text.trim()) return { ok: false, code: "send_failed" }
  return sendEmail({ to, subject: rendered.subject, text: rendered.text, language }, clinic.name)
}

export { EmailError }
