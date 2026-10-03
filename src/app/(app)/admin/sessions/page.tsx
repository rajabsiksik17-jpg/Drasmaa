import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { MonitorSmartphone } from "lucide-react"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { isoDaysAgo } from "@/lib/dates"
import { PageHeader, SectionCard } from "@/components/common/page"
import { SessionsList, type SessionRow } from "@/components/security/sessions-list"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("sessions") }
}

/** All users' recent sessions (sessions.view); revoking needs sessions.revoke. */
export default async function AdminSessionsPage() {
  const session = await requirePagePermission(P.sessionsView)
  const t = await getTranslations("sessions")
  const supabase = await createClient()
  const since = isoDaysAgo(14)
  const [{ data: rows }, { data: profiles }] = await Promise.all([
    supabase
      .from("user_sessions")
      .select("id, user_id, status, auth_method, otp_verified_at, ip, browser, os, device_type, created_at, last_seen_at, ended_at")
      .gte("last_seen_at", since)
      .order("last_seen_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("id, full_name, email"),
  ])
  const users = new Map((profiles ?? []).map((p) => [p.id as string, { full_name: p.full_name as string, email: p.email as string | null }]))
  const sessions = ((rows ?? []) as SessionRow[]).map((s) => ({ ...s, user: users.get(s.user_id) ?? null }))
  const active = sessions.filter((s) => s.status === "active" || s.status === "pending_otp")
  const ended = sessions.filter((s) => !(s.status === "active" || s.status === "pending_otp"))
  const canRevoke = hasPermission(session, P.sessionsRevoke)
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title={t("adminTitle")} description={t("adminHint")} />
      <SectionCard title={t("activeCount", { count: active.length })} icon={MonitorSmartphone}>
        <SessionsList sessions={active} currentSessionId={session.sessionId} canRevokeOthers={canRevoke} showUser />
      </SectionCard>
      {ended.length > 0 && (
        <SectionCard title={t("endedRecently")} icon={MonitorSmartphone}>
          <SessionsList sessions={ended.slice(0, 50)} currentSessionId={session.sessionId} canRevokeOthers={false} showUser />
        </SectionCard>
      )}
    </div>
  )
}
