import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ClientInfo } from "./request-info"

export type LoginEvent =
  | "login_success"
  | "login_failed"
  | "login_locked"
  | "logout"
  | "otp_sent"
  | "otp_verified"
  | "otp_failed"
  | "otp_expired"
  | "otp_locked"
  | "password_changed"
  | "password_reset_requested"

export const isServiceRoleConfigured = () =>
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)

/** Append-only login log (never contains passwords or codes). */
export async function logLoginEvent(
  event: LoginEvent,
  info: Partial<ClientInfo>,
  extra: {
    userId?: string | null
    email?: string | null
    sessionId?: string | null
    reason?: string
    otpUsed?: boolean
    authMethod?: string
  } = {},
) {
  if (!isServiceRoleConfigured()) return
  try {
    const { error } = await createAdminClient()
      .from("login_events")
      .insert({
        event,
        user_id: extra.userId ?? null,
        email: extra.email?.toLowerCase().slice(0, 320) ?? null,
        session_id: extra.sessionId ?? null,
        ip: info.ip ?? null,
        user_agent: info.userAgent ?? null,
        browser: info.browser ?? null,
        os: info.os ?? null,
        device_type: info.deviceType ?? null,
        auth_method: extra.authMethod ?? null,
        otp_used: extra.otpUsed ?? null,
        reason: extra.reason?.slice(0, 200) ?? null,
      })
    if (error) console.error(`[security] login event not recorded: ${error.code}`)
  } catch (e) {
    console.error(`[security] login event not recorded: ${(e as Error).message}`)
  }
}

export async function logSecurityEvent(
  type: string,
  severity: "info" | "warning" | "critical",
  summary: string,
  opts: { actorId?: string | null; targetUserId?: string | null; metadata?: Record<string, unknown>; ip?: string | null } = {},
) {
  if (!isServiceRoleConfigured()) return
  try {
    const { error } = await createAdminClient().rpc("log_security_event", {
      p_type: type,
      p_severity: severity,
      p_summary: summary,
      p_target: opts.targetUserId ?? null,
      p_metadata: opts.metadata ?? {},
      p_actor: opts.actorId ?? null,
      p_ip: opts.ip ?? null,
    })
    if (error) console.error(`[security] event not recorded: ${error.code}`)
  } catch (e) {
    console.error(`[security] event not recorded: ${(e as Error).message}`)
  }
}

/** Notify one user / all holders of a permission (server-side, service role). */
export async function notify(
  target: { user: string } | { permission: string; exclude?: string | null },
  type: string,
  title: string,
  message: string | null,
  opts: { data?: Record<string, unknown>; link?: string | null; priority?: string } = {},
) {
  if (!isServiceRoleConfigured()) return
  const admin = createAdminClient()
  const { error } =
    "user" in target
      ? await admin.rpc("notify_user", {
          p_recipient: target.user,
          p_type: type,
          p_title: title,
          p_message: message,
          p_data: opts.data ?? {},
          p_link: opts.link ?? null,
          p_priority: opts.priority ?? null,
        })
      : await admin.rpc("notify_permission", {
          p_permission: target.permission,
          p_type: type,
          p_title: title,
          p_message: message,
          p_data: opts.data ?? {},
          p_link: opts.link ?? null,
          p_exclude: target.exclude ?? null,
        })
  if (error) console.error(`[notify] ${type} failed: ${error.code}`)
}
