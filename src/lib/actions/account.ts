"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { LOCALE_COOKIE, isLocale } from "@/i18n/config"
import type { AppNotification } from "@/types/db"
import { endSession } from "@/lib/actions/auth"
import { clientInfo } from "@/lib/security/request-info"
import { limit } from "@/lib/security/rate-limit"
import { logLoginEvent, logSecurityEvent, notify } from "@/lib/security/events"

export async function setLocale(locale: string): Promise<ActionResult> {
  if (!isLocale(locale)) return fail("validation")
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
  const auth = await authorize()
  if (auth.session) {
    const supabase = await createClient()
    await supabase.from("profiles").update({ locale }).eq("id", auth.session.userId)
  }
  revalidatePath("/", "layout")
  return ok(undefined)
}

const prefsSchema = z.object({
  density: z.enum(["comfortable", "compact"]).optional(),
  dashboard: z.enum(["default", "queue_first"]).optional(),
  notify_checkin: z.boolean().optional(),
  notify_reminders: z.boolean().optional(),
  sound_alerts: z.boolean().optional(),
})

export async function updatePreferences(patch: z.input<typeof prefsSchema>): Promise<ActionResult> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const parsed = prefsSchema.safeParse(patch)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase
    .from("profiles")
    .update({ preferences: { ...auth.session.profile.preferences, ...parsed.data } })
    .eq("id", auth.session.userId)
  if (error) return dbFail("updatePreferences", error)
  revalidatePath("/", "layout")
  return ok(undefined)
}

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const auth = await authorize()
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null)
  if (error) return dbFail("markNotificationRead", error)
  return ok(undefined)
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", auth.session.userId)
    .is("read_at", null)
  if (error) return dbFail("markAllNotificationsRead", error)
  return ok(undefined)
}

export async function signOut() {
  await endSession()
  redirect("/login")
}

export async function changePassword(password: string): Promise<ActionResult> {
  const auth = await authorize()
  if (auth.error) return auth.error
  if (password.length < 10 || password.length > 200) return fail("validation", ["password"])
  if (!(await limit("sensitivePerUser", auth.session.userId))) return fail("rateLimited")
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return fail("validation", ["password"])
  const info = await clientInfo()
  await logLoginEvent("password_changed", info, { userId: auth.session.userId, email: auth.session.email, sessionId: auth.session.sessionId })
  await logSecurityEvent("account.password_changed", "info", "Password changed", { actorId: auth.session.userId, targetUserId: auth.session.userId, ip: info.ip })
  await notify({ user: auth.session.userId }, "password_changed", "Your password was changed", `${info.browser} / ${info.os}`, {
    link: "/settings/security",
  })
  return ok(undefined)
}

const listSchema = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  category: z.enum(["appointments", "patients", "medical", "system", "security", "admin"]).optional(),
  unreadOnly: z.boolean().optional(),
})

/** Paged notification history (server-side filtering; 30 per page). */
export async function listNotifications(input: z.input<typeof listSchema>): Promise<ActionResult<AppNotification[]>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const parsed = listSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  let q = supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", auth.session.userId)
    .is("voided_at", null)
    .order("created_at", { ascending: false })
    .limit(30)
  if (parsed.data.before) q = q.lt("created_at", parsed.data.before)
  if (parsed.data.category) q = q.eq("category", parsed.data.category)
  if (parsed.data.unreadOnly) q = q.is("read_at", null)
  const { data, error } = await q
  if (error) return dbFail("listNotifications", error)
  return ok((data ?? []) as AppNotification[])
}
