import "server-only"
import { randomUUID } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { sendTemplatedEmail } from "@/lib/email/send"
import { hmac, randomDigits, safeEqualHex } from "./crypto"

export interface OtpPolicy {
  otp_mode: "disabled" | "new_device" | "every_login"
  otp_scope: "all" | "roles"
  otp_length: number
  otp_ttl_seconds: number
  otp_max_attempts: number
  otp_resend_cooldown_seconds: number
  otp_max_sends_per_hour: number
  trusted_device_days: number
  login_max_failures: number
  login_lockout_minutes: number
}

export async function loadPolicy(): Promise<OtpPolicy> {
  const { data } = await createAdminClient().from("auth_security_settings").select("*").eq("id", 1).single()
  return data as OtpPolicy
}

const codeHash = (challengeId: string, code: string) => hmac("otp", `${challengeId}:${code}`)

export type SendOtpResult =
  | { ok: true; expiresAt: string; resendAt: string }
  | { ok: false; code: "otpCooldown" | "rateLimited" | "emailFailed" | "emailNotConfigured"; waitSeconds?: number }

/**
 * Issues a fresh code for a pending session and emails it. Previous codes
 * of the session are invalidated. Only the HMAC of the code is stored.
 */
export async function issueOtp(params: {
  userId: string
  sessionId: string
  email: string
  name: string
  language: "ar" | "en"
}): Promise<SendOtpResult> {
  const admin = createAdminClient()
  const policy = await loadPolicy()

  const { data: last } = await admin
    .from("otp_challenges")
    .select("id, last_sent_at, consumed_at, invalidated_at, expires_at")
    .eq("session_id", params.sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (last && !last.consumed_at && !last.invalidated_at) {
    const elapsed = (Date.now() - new Date(last.last_sent_at).getTime()) / 1000
    if (elapsed < policy.otp_resend_cooldown_seconds) {
      return { ok: false, code: "otpCooldown", waitSeconds: Math.ceil(policy.otp_resend_cooldown_seconds - elapsed) }
    }
  }

  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await admin
    .from("otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .gte("created_at", hourAgo)
  if ((count ?? 0) >= policy.otp_max_sends_per_hour) return { ok: false, code: "rateLimited" }

  await admin
    .from("otp_challenges")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("session_id", params.sessionId)
    .is("consumed_at", null)
    .is("invalidated_at", null)

  const id = randomUUID()
  const code = randomDigits(policy.otp_length)
  const expiresAt = new Date(Date.now() + policy.otp_ttl_seconds * 1000).toISOString()
  const { error } = await admin.from("otp_challenges").insert({
    id,
    user_id: params.userId,
    session_id: params.sessionId,
    code_hash: codeHash(id, code),
    expires_at: expiresAt,
    max_attempts: policy.otp_max_attempts,
  })
  if (error) {
    console.error(`[otp] challenge not stored: ${error.code}`)
    return { ok: false, code: "emailFailed" }
  }

  const minutes = String(Math.round(policy.otp_ttl_seconds / 60))
  const sent = await sendTemplatedEmail(
    "otp_code",
    params.email,
    params.language,
    { user_name: params.name, user_email: params.email, otp_code: code, otp_minutes: minutes },
    {
      subject: params.language === "ar" ? "رمز التحقق" : "Your verification code",
      text:
        params.language === "ar"
          ? `رمز التحقق الخاص بك هو: ${code}\nصالح لمدة ${minutes} دقائق ولمرة واحدة فقط.`
          : `Your verification code is: ${code}\nIt expires in ${minutes} minutes and can be used once.`,
    },
  )
  if (!sent.ok) {
    await admin.from("otp_challenges").update({ invalidated_at: new Date().toISOString() }).eq("id", id)
    return { ok: false, code: sent.code === "not_configured" ? "emailNotConfigured" : "emailFailed" }
  }
  return {
    ok: true,
    expiresAt,
    resendAt: new Date(Date.now() + policy.otp_resend_cooldown_seconds * 1000).toISOString(),
  }
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; code: "otpInvalid"; remaining: number }
  | { ok: false; code: "otpExpired" | "otpLocked" }

/** Single-use, attempt-limited, constant-time verification. */
export async function verifyOtpCode(sessionId: string, code: string): Promise<VerifyOtpResult> {
  const admin = createAdminClient()
  const { data: ch } = await admin
    .from("otp_challenges")
    .select("id, code_hash, expires_at, attempts, max_attempts, consumed_at, invalidated_at")
    .eq("session_id", sessionId)
    .is("consumed_at", null)
    .is("invalidated_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ch) return { ok: false, code: "otpExpired" }
  if (new Date(ch.expires_at).getTime() <= Date.now()) {
    await admin.from("otp_challenges").update({ invalidated_at: new Date().toISOString() }).eq("id", ch.id)
    return { ok: false, code: "otpExpired" }
  }
  if (ch.attempts >= ch.max_attempts) return { ok: false, code: "otpLocked" }

  // Count the attempt first (optimistic on the previous count → no parallel guessing).
  const { data: counted } = await admin
    .from("otp_challenges")
    .update({ attempts: ch.attempts + 1 })
    .eq("id", ch.id)
    .eq("attempts", ch.attempts)
    .select("id")
    .maybeSingle()
  if (!counted) return { ok: false, code: "otpInvalid", remaining: Math.max(0, ch.max_attempts - ch.attempts - 1) }

  const clean = code.replace(/\D/g, "")
  if (!safeEqualHex(codeHash(ch.id, clean), ch.code_hash)) {
    const remaining = ch.max_attempts - (ch.attempts + 1)
    if (remaining <= 0) {
      await admin.from("otp_challenges").update({ invalidated_at: new Date().toISOString() }).eq("id", ch.id)
      return { ok: false, code: "otpLocked" }
    }
    return { ok: false, code: "otpInvalid", remaining }
  }

  const { data: consumed } = await admin
    .from("otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", ch.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle()
  return consumed ? { ok: true } : { ok: false, code: "otpExpired" }
}

/** Failed sign-ins for an email within the lockout window. */
export async function recentFailures(email: string, minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const { count } = await createAdminClient()
    .from("login_events")
    .select("id", { count: "exact", head: true })
    .eq("event", "login_failed")
    .eq("email", email.toLowerCase())
    .gte("occurred_at", since)
  return count ?? 0
}

export const maskEmail = (email: string) => {
  const [name, domain] = email.split("@")
  if (!domain) return "***"
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`
}
