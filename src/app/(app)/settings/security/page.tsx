import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { MonitorSmartphone, ShieldCheck, History } from "lucide-react"
import { requireSession } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { isoDaysAgo } from "@/lib/dates"
import { PageHeader, SectionCard } from "@/components/common/page"
import { SessionsList, type SessionRow } from "@/components/security/sessions-list"
import { TrustedDevices, type TrustedDeviceRow } from "@/components/security/trusted-devices"
import { LoginActivity, type LoginEventRow } from "@/components/security/login-activity"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sessions")
  return { title: t("mySecurity") }
}

/** Settings → Security: the user's own sessions, trusted browsers and sign-in history. */
export default async function MySecurityPage() {
  const session = await requireSession()
  const t = await getTranslations("sessions")
  const supabase = await createClient()
  const since = isoDaysAgo(30)
  const [{ data: sessions }, { data: devices }, { data: events }] = await Promise.all([
    supabase
      .from("user_sessions")
      .select("id, user_id, status, auth_method, otp_verified_at, ip, browser, os, device_type, created_at, last_seen_at, ended_at")
      .eq("user_id", session.userId)
      .gte("last_seen_at", since)
      .order("last_seen_at", { ascending: false })
      .limit(30),
    supabase.from("trusted_devices").select("id, label, created_at, last_used_at, expires_at, revoked_at").eq("user_id", session.userId).is("revoked_at", null).order("created_at", { ascending: false }),
    supabase
      .from("login_events")
      .select("id, occurred_at, event, ip, browser, os, device_type, reason")
      .eq("user_id", session.userId)
      .order("occurred_at", { ascending: false })
      .limit(20),
  ])
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t("mySecurity")} description={t("mySecurityHint")} breadcrumbs={[{ href: "/settings", label: t("settings") }, { label: t("mySecurity") }]} />
      <SectionCard title={t("activeSessions")} icon={MonitorSmartphone}>
        <SessionsList sessions={(sessions ?? []) as SessionRow[]} currentSessionId={session.sessionId} canRevokeOthers showSignOutOthers />
      </SectionCard>
      <SectionCard title={t("trustedDevices")} icon={ShieldCheck}>
        <TrustedDevices devices={(devices ?? []) as TrustedDeviceRow[]} />
      </SectionCard>
      <SectionCard title={t("recentActivity")} icon={History} bodyClassName="p-0">
        <LoginActivity events={(events ?? []) as LoginEventRow[]} />
      </SectionCard>
    </div>
  )
}
