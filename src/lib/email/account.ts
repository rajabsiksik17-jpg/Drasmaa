import "server-only"
import nodemailer, { type Transporter } from "nodemailer"
import { ImapFlow } from "imapflow"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/security/crypto"

export type Security = "ssl" | "tls" | "starttls" | "none"

export interface EmailAccountSecrets {
  id: string
  email_address: string
  display_name: string
  smtp_host: string
  smtp_port: number
  smtp_security: Security
  smtp_username: string
  smtp_password: string | null
  imap_enabled: boolean
  imap_host: string | null
  imap_port: number | null
  imap_security: Security | null
  imap_username: string | null
  imap_password: string | null
}

/** Stable, user-safe failure codes (details only go to the server log). */
export type EmailErrorCode =
  | "not_configured"
  | "encryption_key_missing"
  | "connection_failed"
  | "tls_failed"
  | "auth_failed"
  | "recipient_rejected"
  | "send_failed"
  | "timeout"

export class EmailError extends Error {
  constructor(public code: EmailErrorCode, detail?: string) {
    super(detail ?? code)
  }
}

/** Maps nodemailer / imapflow / socket errors to safe codes. */
export function classifyEmailError(e: unknown): EmailErrorCode {
  if (e instanceof EmailError) return e.code
  const err = e as { code?: string; responseCode?: number; authenticationFailed?: boolean; message?: string }
  const code = err?.code ?? ""
  const msg = (err?.message ?? "").toLowerCase()
  if (err?.authenticationFailed || code === "EAUTH" || err?.responseCode === 535 || /auth/.test(msg)) return "auth_failed"
  if (code === "ETIMEDOUT" || /timeout|timed out/.test(msg)) return "timeout"
  if (/certificate|tls|ssl|wrong version number/.test(msg) || code.startsWith("ERR_TLS") || code === "ETLS") return "tls_failed"
  if (code === "EENVELOPE" || (err?.responseCode ?? 0) >= 550) return "recipient_rejected"
  if (["ECONNECTION", "ECONNREFUSED", "ENOTFOUND", "EDNS", "ESOCKET", "EHOSTUNREACH", "ECONNRESET"].includes(code)) return "connection_failed"
  return "send_failed"
}

/** Server log line without credentials (messages from mail servers never include the password). */
export function logEmailError(context: string, e: unknown) {
  const err = e as { code?: string; responseCode?: number; message?: string; command?: string }
  console.error(
    `[email] ${context}: code=${err?.code ?? "?"} response=${err?.responseCode ?? "-"} command=${err?.command ?? "-"} message=${(err?.message ?? "").slice(0, 300)}`,
  )
}

export async function loadEmailAccount(): Promise<EmailAccountSecrets | null> {
  const { data, error } = await createAdminClient().from("email_accounts").select("*").eq("is_default", true).maybeSingle()
  if (error) {
    console.error(`[email] cannot load account: ${error.code}`)
    return null
  }
  if (!data) return null
  try {
    return {
      ...data,
      smtp_password: data.smtp_password_enc ? decryptSecret(data.smtp_password_enc) : null,
      imap_password: data.imap_password_enc ? decryptSecret(data.imap_password_enc) : null,
    } as EmailAccountSecrets
  } catch {
    throw new EmailError("encryption_key_missing", "Stored credentials cannot be decrypted with the current APP_ENCRYPTION_KEY.")
  }
}

export function smtpTransport(a: Pick<EmailAccountSecrets, "smtp_host" | "smtp_port" | "smtp_security" | "smtp_username" | "smtp_password">): Transporter {
  const secure = a.smtp_security === "ssl"
  return nodemailer.createTransport({
    host: a.smtp_host,
    port: a.smtp_port,
    secure,
    requireTLS: a.smtp_security === "tls",
    ignoreTLS: a.smtp_security === "none",
    auth: a.smtp_password ? { user: a.smtp_username, pass: a.smtp_password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { minVersion: "TLSv1.2", servername: a.smtp_host },
    logger: false,
    debug: false,
  })
}

export function imapClient(a: Pick<EmailAccountSecrets, "imap_host" | "imap_port" | "imap_security" | "imap_username" | "imap_password">) {
  return new ImapFlow({
    host: a.imap_host ?? "",
    port: a.imap_port ?? 993,
    secure: a.imap_security === "ssl" || a.imap_security === "tls",
    doSTARTTLS: a.imap_security === "starttls" ? true : a.imap_security === "none" ? false : undefined,
    auth: { user: a.imap_username ?? "", pass: a.imap_password ?? "" },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { minVersion: "TLSv1.2" },
  })
}

/** Record the outcome of a real send on the account (diagnostics). */
export async function recordSendOutcome(accountId: string, ok: boolean, code?: EmailErrorCode) {
  const now = new Date().toISOString()
  await createAdminClient()
    .from("email_accounts")
    .update(ok ? { last_success_email_at: now, smtp_status: "ok" } : { last_failed_email_at: now, last_error_code: code ?? "send_failed" })
    .eq("id", accountId)
}
