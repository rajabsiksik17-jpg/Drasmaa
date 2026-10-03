"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { encryptSecret, isEncryptionConfigured } from "@/lib/security/crypto"
import { isServiceRoleConfigured, logSecurityEvent, notify } from "@/lib/security/events"
import { clientInfo } from "@/lib/security/request-info"
import { limit } from "@/lib/security/rate-limit"
import {
  classifyEmailError,
  imapClient,
  loadEmailAccount,
  logEmailError,
  smtpTransport,
  type EmailErrorCode,
} from "@/lib/email/account"
import { clinicInfo, isValidEmail, renderEmail, sendEmail, templateForPurpose } from "@/lib/email/send"

const host = z.string().trim().min(3).max(253).regex(/^[A-Za-z0-9.-]+$/)
const security = z.enum(["ssl", "tls", "starttls", "none"])
const secret = z.string().max(500).optional()

const accountSchema = z
  .object({
    email_address: z.email().max(320),
    display_name: z.string().trim().min(1).max(120).regex(/^[^\r\n<>"]+$/),
    smtp_host: host,
    smtp_port: z.coerce.number().int().min(1).max(65535),
    smtp_security: security,
    smtp_username: z.string().trim().min(1).max(200),
    smtp_password: secret,
    imap_enabled: z.boolean(),
    imap_host: host.optional().or(z.literal("")),
    imap_port: z.coerce.number().int().min(1).max(65535).optional(),
    imap_security: security.optional(),
    imap_username: z.string().trim().max(200).optional(),
    imap_password: secret,
  })
  .refine((v) => !v.imap_enabled || (v.imap_host && v.imap_port && v.imap_security && v.imap_username), {
    path: ["imap_host"],
  })

function preconditions(): ActionResult<never> | null {
  if (!isServiceRoleConfigured()) return fail("serviceKeyMissing")
  if (!isEncryptionConfigured()) return fail("encryptionKeyMissing")
  return null
}

/** Saves the clinic email account. Passwords: blank = keep the stored one. */
export async function saveEmailAccount(input: z.input<typeof accountSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsEmailManage)
  if (auth.error) return auth.error
  const pre = preconditions()
  if (pre) return pre
  const parsed = accountSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("email_accounts")
    .select("id, smtp_password_enc, imap_password_enc")
    .eq("is_default", true)
    .maybeSingle()
  if (!v.smtp_password && !existing?.smtp_password_enc) return fail("validation", ["smtp_password"])
  if (v.imap_enabled && !v.imap_password && !existing?.imap_password_enc) return fail("validation", ["imap_password"])

  const row = {
    is_default: true,
    email_address: v.email_address.toLowerCase(),
    display_name: v.display_name,
    smtp_host: v.smtp_host.toLowerCase(),
    smtp_port: v.smtp_port,
    smtp_security: v.smtp_security,
    smtp_username: v.smtp_username,
    smtp_password_enc: v.smtp_password ? encryptSecret(v.smtp_password) : existing?.smtp_password_enc,
    imap_enabled: v.imap_enabled,
    imap_host: v.imap_enabled ? v.imap_host?.toLowerCase() || null : null,
    imap_port: v.imap_enabled ? (v.imap_port ?? null) : null,
    imap_security: v.imap_enabled ? (v.imap_security ?? null) : null,
    imap_username: v.imap_enabled ? v.imap_username || null : null,
    imap_password_enc: v.imap_enabled ? (v.imap_password ? encryptSecret(v.imap_password) : existing?.imap_password_enc) : null,
    smtp_status: "unknown",
    imap_status: v.imap_enabled ? "unknown" : "disabled",
    last_error_code: null,
    updated_by: auth.session.userId,
    ...(existing ? {} : { created_by: auth.session.userId }),
  }
  const { error } = existing
    ? await admin.from("email_accounts").update(row).eq("id", existing.id)
    : await admin.from("email_accounts").insert(row)
  if (error) {
    console.error(`[email] save failed: ${error.code} ${error.message}`)
    return fail(error.code === "23514" ? "invalidValue" : "unexpected")
  }
  const info = await clientInfo()
  await logSecurityEvent("email.config_changed", "warning", "Email configuration changed", {
    actorId: auth.session.userId,
    ip: info.ip,
    metadata: {
      smtp_host: row.smtp_host,
      imap_enabled: row.imap_enabled,
      smtp_password_changed: Boolean(v.smtp_password),
      imap_password_changed: Boolean(v.imap_password),
    },
  })
  await notify({ permission: "settings.email.manage", exclude: auth.session.userId }, "config_changed", "Email configuration changed", row.email_address, {
    link: "/admin/email",
  })
  revalidatePath("/admin/email")
  return ok(undefined)
}

export interface ConnectionTestResult {
  smtp: { connected: boolean; authenticated: boolean; sent: boolean | null; error: EmailErrorCode | null }
  imap: { enabled: boolean; connected: boolean; authenticated: boolean; error: EmailErrorCode | null }
  testedAt: string
}

const testSchema = z.object({ sendTo: z.email().max(320).optional().or(z.literal("")) })

/** Independent SMTP + IMAP checks (connection, authentication, real test email). */
export async function testEmailConnection(input: z.input<typeof testSchema>): Promise<ActionResult<ConnectionTestResult>> {
  const auth = await authorize(P.settingsEmailManage)
  if (auth.error) return auth.error
  const pre = preconditions()
  if (pre) return pre
  const parsed = testSchema.safeParse(input)
  if (!parsed.success) return fail("invalidEmail")
  if (!(await limit("emailTestPerUser", auth.session.userId))) return fail("rateLimited")

  let account
  try {
    account = await loadEmailAccount()
  } catch (e) {
    return fail(classifyEmailError(e) === "encryption_key_missing" ? "encryptionKeyMissing" : "unexpected")
  }
  if (!account) return fail("emailNotConfigured")
  const started = Date.now()
  const result: ConnectionTestResult = {
    smtp: { connected: false, authenticated: false, sent: null, error: null },
    imap: { enabled: account.imap_enabled, connected: false, authenticated: false, error: null },
    testedAt: new Date().toISOString(),
  }

  // 1–2. SMTP connection + authentication
  const transport = smtpTransport(account)
  try {
    await transport.verify()
    result.smtp.connected = true
    result.smtp.authenticated = true
  } catch (e) {
    const code = classifyEmailError(e)
    logEmailError("smtp verify", e)
    result.smtp.error = code
    result.smtp.connected = code === "auth_failed"
  } finally {
    transport.close()
  }

  // 3. Real test email
  if (result.smtp.authenticated) {
    const to = parsed.data.sendTo || auth.session.email || account.email_address
    if (isValidEmail(to)) {
      const language = auth.session.profile.locale === "ar" ? "ar" : "en"
      const clinic = await clinicInfo(language)
      const template = await templateForPurpose("email", "test_email")
      const rendered = template
        ? renderEmail(template, language, { clinic_name: clinic.name, clinic_phone: clinic.phone, clinic_address: clinic.address })
        : { subject: `Test email — ${clinic.name}`, text: `This is a test email from ${clinic.name}.` }
      const sent = await sendEmail({ to, subject: rendered.subject, text: rendered.text, language }, clinic.name)
      result.smtp.sent = sent.ok
      if (!sent.ok) result.smtp.error = sent.code
    }
  }

  // 4–5. IMAP connection + authentication
  if (account.imap_enabled && account.imap_host) {
    const client = imapClient(account)
    client.on("error", () => {})
    try {
      await client.connect()
      result.imap.connected = true
      result.imap.authenticated = true
      await client.logout().catch(() => {})
    } catch (e) {
      const code = classifyEmailError(e)
      logEmailError("imap connect", e)
      result.imap.error = code
      result.imap.connected = code === "auth_failed"
      client.close()
    }
  }

  const admin = createAdminClient()
  await admin.from("email_connection_tests").insert({
    account_id: account.id,
    tested_by: auth.session.userId,
    smtp_connected: result.smtp.connected,
    smtp_authenticated: result.smtp.authenticated,
    smtp_test_sent: result.smtp.sent,
    imap_connected: account.imap_enabled ? result.imap.connected : null,
    imap_authenticated: account.imap_enabled ? result.imap.authenticated : null,
    error_code: result.smtp.error ?? result.imap.error,
    duration_ms: Date.now() - started,
  })
  const smtpOk = result.smtp.authenticated && result.smtp.sent !== false
  await admin
    .from("email_accounts")
    .update({
      smtp_status: smtpOk ? "ok" : "failed",
      imap_status: account.imap_enabled ? (result.imap.authenticated ? "ok" : "failed") : "disabled",
      last_test_at: result.testedAt,
      last_error_code: result.smtp.error ?? result.imap.error,
    })
    .eq("id", account.id)
  await logSecurityEvent("email.connection_test", smtpOk ? "info" : "warning", smtpOk ? "Email connection test passed" : "Email connection test failed", {
    actorId: auth.session.userId,
    metadata: { smtp_ok: smtpOk, imap_ok: result.imap.authenticated, error: result.smtp.error ?? result.imap.error },
  })
  revalidatePath("/admin/email")
  return ok(result)
}
