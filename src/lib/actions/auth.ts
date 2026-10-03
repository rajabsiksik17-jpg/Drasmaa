"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { fail, ok, type ActionResult } from "@/lib/errors"
import { clientInfo, type ClientInfo } from "@/lib/security/request-info"
import { deviceHash } from "@/lib/security/device"
import { limit } from "@/lib/security/rate-limit"
import { isServiceRoleConfigured, logLoginEvent, logSecurityEvent, notify } from "@/lib/security/events"
import { issueOtp, loadPolicy, maskEmail, recentFailures, verifyOtpCode } from "@/lib/security/otp"

const safeNext = (next: string | null | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/dashboard"

function claimsOf(accessToken: string): { sub?: string; session_id?: string; email?: string } {
  try {
    return JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"))
  } catch {
    return {}
  }
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** Registers the current Supabase session (idempotent) and returns its state. */
async function registerCurrentSession(supabase: ServerClient, info: ClientInfo, method: "password" | "other") {
  const { data, error } = await supabase.rpc("register_session", {
    p_device_hash: await deviceHash(true),
    p_ip: info.ip,
    p_user_agent: info.userAgent,
    p_browser: info.browser,
    p_os: info.os,
    p_device_type: info.deviceType,
    p_auth_method: method,
  })
  if (error) {
    if (error.code === "PGRST202") return { status: "active", otp_required: false, new_device: false } // legacy schema
    console.error(`[auth] register_session failed: ${error.code} ${error.message}`)
    return null
  }
  return data as { status: string; otp_required: boolean; new_device: boolean }
}

const signInSchema = z.object({ email: z.email().max(320), password: z.string().min(1).max(200), next: z.string().max(500).optional() })

/**
 * Password sign-in on the server: rate limits, temporary lockout after
 * repeated failures, login log, session registration and — when the
 * policy requires it — an emailed one-time code before access is granted.
 */
export async function signIn(input: z.input<typeof signInSchema>): Promise<ActionResult<{ next: string }>> {
  const parsed = signInSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const email = parsed.data.email.trim().toLowerCase()
  const info = await clientInfo()

  if (!(await limit("loginPerIp", info.ip ?? "unknown")) || !(await limit("loginPerEmail", email))) {
    await logLoginEvent("login_locked", info, { email, reason: "rate_limit" })
    return fail("rateLimited")
  }

  const policy = isServiceRoleConfigured() ? await loadPolicy().catch(() => null) : null
  if (policy) {
    const failures = await recentFailures(email, policy.login_lockout_minutes)
    if (failures >= policy.login_max_failures) {
      await logLoginEvent("login_locked", info, { email, reason: "too_many_failures" })
      return fail("accountLocked", undefined, policy.login_lockout_minutes)
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password })
  if (error || !data.session) {
    await logLoginEvent("login_failed", info, { email, reason: error?.code ?? "invalid" })
    if (policy) {
      const failures = await recentFailures(email, policy.login_lockout_minutes)
      if (failures === policy.login_max_failures) {
        await logSecurityEvent("login.suspicious", "critical", "Repeated failed sign-ins — account temporarily locked", {
          ip: info.ip,
          metadata: { email_masked: maskEmail(email), failures },
        })
        await notify({ permission: "security.view" }, "login_failed", "Suspicious login attempts", maskEmail(email), {
          link: "/admin/security",
          data: { failures },
        })
      }
    }
    return fail(error?.status === 400 ? "unauthenticated" : "unexpected")
  }

  const claims = claimsOf(data.session.access_token)
  const state = await registerCurrentSession(supabase, info, "password")
  await logLoginEvent("login_success", info, {
    userId: data.user.id,
    email,
    sessionId: claims.session_id ?? null,
    authMethod: "password",
  })
  if (!state) {
    // e.g. deactivated account: never leave a half-open session behind.
    await supabase.auth.signOut({ scope: "local" })
    return fail("forbidden")
  }
  if (state.status === "pending_otp") {
    await sendCodeForSession(data.user.id, claims.session_id ?? "", email, info)
    return ok({ next: `/login/verify?next=${encodeURIComponent(safeNext(parsed.data.next))}` })
  }
  return ok({ next: safeNext(parsed.data.next) })
}

async function sendCodeForSession(userId: string, sessionId: string, email: string, info: ClientInfo) {
  const { data: profile } = await createAdminClient().from("profiles").select("full_name, locale").eq("id", userId).single()
  const res = await issueOtp({
    userId,
    sessionId,
    email,
    name: profile?.full_name ?? "",
    language: profile?.locale === "ar" ? "ar" : "en",
  })
  if (res.ok) await logLoginEvent("otp_sent", info, { userId, email, sessionId })
  return res
}

export interface VerificationState {
  status: "active" | "pending_otp" | "ended"
  email?: string
  expiresAt?: string
  resendAt?: string
  error?: "emailNotConfigured" | "emailFailed" | "rateLimited"
  rememberAllowed?: boolean
}

/**
 * Entry point of /login/verify for any session that is not active yet
 * (e.g. after a password-reset link, or sessions that existed before the
 * security policy was introduced). Registers the session and sends a code
 * when required and none is pending.
 */
export async function startVerification(): Promise<ActionResult<VerificationState>> {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims?.sub) return ok({ status: "ended" })
  const info = await clientInfo()
  const state = await registerCurrentSession(supabase, info, "other")
  if (!state) return fail("unexpected")
  if (state.status === "active") return ok({ status: "active" })
  if (state.status !== "pending_otp") return ok({ status: "ended" })

  const sessionId = claims.session_id as string
  const email = (claims.email as string | undefined) ?? ""
  const policy = await loadPolicy()
  const admin = createAdminClient()
  const { data: current } = await admin
    .from("otp_challenges")
    .select("expires_at, last_sent_at")
    .eq("session_id", sessionId)
    .is("consumed_at", null)
    .is("invalidated_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const base = { status: "pending_otp" as const, email: maskEmail(email), rememberAllowed: policy.otp_mode === "new_device" }
  if (current) {
    return ok({
      ...base,
      expiresAt: current.expires_at,
      resendAt: new Date(new Date(current.last_sent_at).getTime() + policy.otp_resend_cooldown_seconds * 1000).toISOString(),
    })
  }
  const sent = await sendCodeForSession(claims.sub, sessionId, email, info)
  if (!sent.ok) {
    return ok({ ...base, error: sent.code === "otpCooldown" ? undefined : sent.code === "rateLimited" ? "rateLimited" : sent.code })
  }
  return ok({ ...base, expiresAt: sent.expiresAt, resendAt: sent.resendAt })
}

export async function resendOtp(): Promise<ActionResult<{ expiresAt: string; resendAt: string }>> {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims?.sub || !claims.session_id) return fail("unauthenticated")
  const { data: s } = await createAdminClient().from("user_sessions").select("status").eq("id", claims.session_id).maybeSingle()
  if (s?.status !== "pending_otp") return fail("unauthenticated")
  const info = await clientInfo()
  const res = await sendCodeForSession(claims.sub, claims.session_id as string, (claims.email as string) ?? "", info)
  if (!res.ok) return fail(res.code, undefined, res.waitSeconds)
  return ok({ expiresAt: res.expiresAt, resendAt: res.resendAt })
}

const verifySchema = z.object({ code: z.string().regex(/^\d{6,8}$/), remember: z.boolean().optional() })

export async function verifyOtp(input: z.input<typeof verifySchema>): Promise<ActionResult<void>> {
  const parsed = verifySchema.safeParse(input)
  if (!parsed.success) return fail("otpInvalid")
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims?.sub || !claims.session_id) return fail("unauthenticated")
  const sessionId = claims.session_id as string
  const userId = claims.sub
  const info = await clientInfo()
  const email = (claims.email as string | undefined) ?? null

  if (!(await limit("otpVerify", sessionId))) return fail("rateLimited")
  const admin = createAdminClient()
  const { data: s } = await admin.from("user_sessions").select("status, device_hash").eq("id", sessionId).maybeSingle()
  if (s?.status !== "pending_otp") return fail("unauthenticated")

  const result = await verifyOtpCode(sessionId, parsed.data.code)
  if (!result.ok) {
    await logLoginEvent(result.code === "otpExpired" ? "otp_expired" : result.code === "otpLocked" ? "otp_locked" : "otp_failed", info, {
      userId,
      email,
      sessionId,
    })
    if (result.code === "otpLocked") {
      await logSecurityEvent("otp.locked", "warning", "Too many wrong verification codes", { targetUserId: userId, ip: info.ip })
    }
    return fail(result.code, undefined, result.code === "otpInvalid" ? result.remaining : undefined)
  }

  const now = new Date().toISOString()
  const { error } = await admin
    .from("user_sessions")
    .update({ status: "active", otp_verified_at: now, auth_method: "password_otp" })
    .eq("id", sessionId)
    .eq("status", "pending_otp")
  if (error) return fail("unexpected")

  const policy = await loadPolicy()
  if (parsed.data.remember && policy.otp_mode === "new_device" && s.device_hash) {
    await admin.from("trusted_devices").upsert(
      {
        user_id: userId,
        device_hash: s.device_hash,
        label: `${info.browser} / ${info.os}`,
        last_used_at: now,
        expires_at: new Date(Date.now() + policy.trusted_device_days * 86400_000).toISOString(),
        revoked_at: null,
      },
      { onConflict: "user_id,device_hash" },
    )
  }
  await admin.rpc("session_activated", { p_session: sessionId })
  await logLoginEvent("otp_verified", info, { userId, email, sessionId, otpUsed: true, authMethod: "password_otp" })
  return ok(undefined)
}

/** Ends the session everywhere it matters (registry + Supabase cookie). */
export async function endSession(): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  await supabase.rpc("end_current_session")
  await supabase.auth.signOut({ scope: "local" })
  if (claimsData?.claims?.sub) {
    await logLoginEvent("logout", await clientInfo(), {
      userId: claimsData.claims.sub,
      sessionId: (claimsData.claims.session_id as string) ?? null,
    })
  }
  return ok(undefined)
}

const resetSchema = z.object({ email: z.email().max(320) })

/** Password-reset email (rate limited; same answer whether or not the account exists). */
export async function requestPasswordReset(input: z.input<typeof resetSchema>): Promise<ActionResult<void>> {
  const parsed = resetSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const info = await clientInfo()
  const email = parsed.data.email.toLowerCase()
  if (!(await limit("passwordReset", info.ip ?? "unknown")) || !(await limit("passwordReset", email))) return fail("rateLimited")
  const supabase = await createClient()
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  // Supabase additionally only accepts redirect URLs from its allow-list.
  const origin = `${proto}://${host}`
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm?next=/login/reset` })
  await logLoginEvent("password_reset_requested", info, { email })
  return ok(undefined)
}
