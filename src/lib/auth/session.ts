import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { PermissionCode } from "@/lib/permissions"
import { fail, type ActionResult } from "@/lib/errors"
import type { Doctor, Profile, Role } from "@/types/db"

export type SessionState = "active" | "pending_otp" | "unregistered" | "revoked" | "signed_out"

export interface Session {
  userId: string
  /** Supabase auth session id (JWT claim) — the unit of OTP / revocation. */
  sessionId: string | null
  /** Only "active" sessions may use the application (enforced in RLS too). */
  state: SessionState
  email: string | null
  profile: Profile
  role: Role | null
  permissions: string[]
  doctor: Doctor | null
}

/**
 * Current user, verified with getClaims() (JWT signature check), plus the
 * role/permission set. Cached per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub
  if (!userId) return null
  const sessionId = (claimsData?.claims?.session_id as string | undefined) ?? null
  const state = await sessionState(supabase)

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, role:roles(*)")
    .eq("id", userId)
    .maybeSingle()
  if (!profile || !profile.active) return null

  const [{ data: perms }, { data: doctor }] = await Promise.all([
    profile.role_id
      ? supabase.from("role_permissions").select("permission_code").eq("role_id", profile.role_id)
      : Promise.resolve({ data: [] as { permission_code: string }[] }),
    supabase.from("doctors").select("*").eq("profile_id", userId).eq("active", true).maybeSingle(),
  ])

  const role = (profile as { role: Role | null }).role
  const { role: _ignored, ...rest } = profile as Profile & { role: unknown }
  void _ignored
  return {
    userId,
    sessionId,
    state,
    email: (claimsData?.claims?.email as string | undefined) ?? profile.email,
    profile: rest as Profile,
    role: role?.active ? role : null,
    permissions: role?.active ? (perms ?? []).map((p) => p.permission_code) : [],
    doctor: (doctor as Doctor | null) ?? null,
  }
})

async function sessionState(supabase: Awaited<ReturnType<typeof createClient>>): Promise<SessionState> {
  const { data, error } = await supabase.rpc("current_session_state")
  if (error) {
    // Database without the security migration: sessions are not gated yet.
    if (error.code === "PGRST202") return "active"
    console.error(`[auth] session state unavailable: ${error.code}`)
    return "unregistered"
  }
  return (data as SessionState) ?? "unregistered"
}

/** A signed-in user whose session is ACTIVE (OTP verified when required). */
export async function requireSession(): Promise<Session> {
  const session = await getSession()
  if (!session) redirect("/login")
  if (session.state === "pending_otp" || session.state === "unregistered") redirect("/login/verify")
  if (session.state !== "active") redirect(`/auth/signout?reason=${session.state}`)
  return session
}

export function hasPermission(session: Session, code: PermissionCode) {
  return session.permissions.includes(code)
}

/** For pages: redirect away when the permission is missing. */
export async function requirePagePermission(...codes: PermissionCode[]): Promise<Session> {
  const session = await requireSession()
  if (!codes.some((c) => hasPermission(session, c))) redirect("/dashboard?denied=1")
  return session
}

/** For server actions: returns an error result instead of redirecting. */
export async function authorize(
  ...codes: PermissionCode[]
): Promise<{ session: Session; error?: undefined } | { session?: undefined; error: ActionResult<never> }> {
  const session = await getSession()
  if (!session || session.state !== "active") return { error: fail("unauthenticated") }
  if (codes.length && !codes.some((c) => hasPermission(session, c))) return { error: fail("forbidden") }
  return { session }
}
