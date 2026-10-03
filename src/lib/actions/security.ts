"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { limit } from "@/lib/security/rate-limit"
import { isServiceRoleConfigured } from "@/lib/security/events"

const policySchema = z.object({
  otp_mode: z.enum(["disabled", "new_device", "every_login"]),
  otp_scope: z.enum(["all", "roles"]),
  otp_roles: z.array(z.uuid()).max(50),
  otp_ttl_seconds: z.number().int().min(60).max(900),
  otp_max_attempts: z.number().int().min(3).max(10),
  otp_resend_cooldown_seconds: z.number().int().min(30).max(600),
  otp_max_sends_per_hour: z.number().int().min(2).max(20),
  trusted_device_days: z.number().int().min(1).max(180),
  login_max_failures: z.number().int().min(3).max(20),
  login_lockout_minutes: z.number().int().min(1).max(1440),
})

/**
 * Authentication policy. OTP can only be switched on when email delivery
 * works — otherwise everybody (including the administrator) would be
 * locked out at the next sign-in.
 */
export async function saveSecurityPolicy(input: z.input<typeof policySchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.securityManage)
  if (auth.error) return auth.error
  const parsed = policySchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  if (!(await limit("sensitivePerUser", auth.session.userId))) return fail("rateLimited")
  if (v.otp_mode !== "disabled") {
    if (!isServiceRoleConfigured()) return fail("serviceKeyMissing")
    const { data: acc } = await createAdminClient().from("email_accounts").select("smtp_status").eq("is_default", true).maybeSingle()
    if (!acc || acc.smtp_status !== "ok") return fail("emailNotConfigured")
    if (v.otp_scope === "roles" && v.otp_roles.length === 0) return fail("validation", ["otp_roles"])
  }
  const supabase = await createClient()
  const { otp_roles, ...policy } = v
  const { error } = await supabase.from("auth_security_settings").update(policy).eq("id", 1)
  if (error) return dbFail("saveSecurityPolicy", error)

  const { data: current } = await supabase.from("otp_role_requirements").select("role_id")
  const have = new Set((current ?? []).map((r) => r.role_id as string))
  const want = new Set(v.otp_scope === "roles" ? otp_roles : [])
  const toAdd = [...want].filter((r) => !have.has(r))
  const toRemove = [...have].filter((r) => !want.has(r))
  if (toAdd.length) {
    const { error: e } = await supabase.from("otp_role_requirements").insert(toAdd.map((role_id) => ({ role_id })))
    if (e) return dbFail("saveSecurityPolicy.roles", e)
  }
  if (toRemove.length) {
    const { error: e } = await supabase.from("otp_role_requirements").delete().in("role_id", toRemove)
    if (e) return dbFail("saveSecurityPolicy.roles", e)
  }
  revalidatePath("/admin/authentication")
  revalidatePath("/admin/security")
  return ok(undefined)
}

export async function revokeSession(sessionId: string): Promise<ActionResult<void>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(sessionId).success) return fail("validation")
  if (sessionId === auth.session.sessionId) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_session", { p_session: sessionId, p_reason: "manual" })
  if (error) return dbFail("revokeSession", error)
  revalidatePath("/settings/security")
  revalidatePath("/admin/sessions")
  return ok(undefined)
}

export async function signOutOtherSessions(): Promise<ActionResult<{ count: number }>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("revoke_other_sessions")
  if (error) return dbFail("signOutOtherSessions", error)
  // Also end the other refresh-token families at the auth server.
  await supabase.auth.signOut({ scope: "others" })
  revalidatePath("/settings/security")
  return ok({ count: Number(data ?? 0) })
}

export async function revokeTrustedDevice(id: string): Promise<ActionResult<void>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase
    .from("trusted_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", auth.session.userId)
  if (error) return dbFail("revokeTrustedDevice", error)
  revalidatePath("/settings/security")
  return ok(undefined)
}

// ---------------------------------------------------------------------
// Notifications configuration
// ---------------------------------------------------------------------

const eventSchema = z.object({ code: z.string().regex(/^[a-z_]+$/), in_app_enabled: z.boolean(), email_enabled: z.boolean() })

export async function saveNotificationEvent(input: z.input<typeof eventSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.notificationsManage)
  if (auth.error) return auth.error
  const parsed = eventSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { data: current } = await supabase.from("notification_event_types").select("is_critical").eq("code", parsed.data.code).maybeSingle()
  if (!current) return fail("notFound")
  const { error } = await supabase
    .from("notification_event_types")
    .update({
      in_app_enabled: current.is_critical ? true : parsed.data.in_app_enabled,
      email_enabled: parsed.data.email_enabled,
    })
    .eq("code", parsed.data.code)
  if (error) return dbFail("saveNotificationEvent", error)
  revalidatePath("/admin/notifications")
  return ok(undefined)
}

const ruleSchema = z.object({ id: z.uuid(), enabled: z.boolean() })

export async function saveReminderRule(input: z.input<typeof ruleSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.notificationsManage)
  if (auth.error) return auth.error
  const parsed = ruleSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("reminder_rules").update({ enabled: parsed.data.enabled }).eq("id", parsed.data.id)
  if (error) return dbFail("saveReminderRule", error)
  revalidatePath("/admin/notifications")
  return ok(undefined)
}

const prefSchema = z.object({ event_code: z.string().regex(/^[a-z_]+$/), in_app: z.boolean(), email: z.boolean() })

/** Personal mute switches (critical security events cannot be muted). */
export async function saveMyNotificationPreference(input: z.input<typeof prefSchema>): Promise<ActionResult<void>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const parsed = prefSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { data: ev } = await supabase.from("notification_event_types").select("is_critical").eq("code", parsed.data.event_code).maybeSingle()
  if (!ev) return fail("notFound")
  if (ev.is_critical && (!parsed.data.in_app || !parsed.data.email)) return fail("forbidden")
  const { error } = await supabase.from("user_notification_preferences").upsert(
    { user_id: auth.session.userId, ...parsed.data, updated_at: new Date().toISOString() },
    { onConflict: "user_id,event_code" },
  )
  if (error) return dbFail("saveMyNotificationPreference", error)
  revalidatePath("/settings")
  return ok(undefined)
}

const whatsappSchema = z.object({
  whatsapp_enabled: z.boolean(),
  whatsapp_country_code: z.string().regex(/^[1-9][0-9]{0,3}$/),
  whatsapp_open_mode: z.enum(["auto", "web", "app"]),
})

export async function saveWhatsappSettings(input: z.input<typeof whatsappSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const parsed = whatsappSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("clinic_settings").update(parsed.data).eq("id", 1)
  if (error) return dbFail("saveWhatsappSettings", error)
  revalidatePath("/admin/whatsapp")
  return ok(undefined)
}
