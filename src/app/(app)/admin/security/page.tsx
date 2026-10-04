import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Activity, AlertTriangle, CheckCircle2, History, MonitorSmartphone, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { isEncryptionConfigured } from "@/lib/security/crypto"
import { isServiceRoleConfigured } from "@/lib/security/events"
import { PageHeader, SectionCard, StatCard } from "@/components/common/page"
import { LoginActivity, type LoginEventRow } from "@/components/security/login-activity"
import { SecurityEventList, type SecurityEventRow } from "@/components/security/security-events"
import { cn } from "@/lib/utils"
import { isoDaysAgo } from "@/lib/dates"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("securityCenter") }
}

type Level = "secure" | "warning" | "action"

/** Settings → Security Center: status at a glance, no technical secrets. */
export default async function SecurityCenterPage() {
  const session = await requirePagePermission(P.securityView)
  const t = await getTranslations("securityCenter")
  const supabase = await createClient()
  const day = isoDaysAgo(1)
  const week = isoDaysAgo(7)

  const [policy, account, activeSessions, failed24, critical7, logins, failures, events, profiles, serverErrors] = await Promise.all([
    supabase.from("auth_security_settings").select("otp_mode, otp_scope, login_max_failures, login_lockout_minutes").eq("id", 1).single(),
    supabase.from("email_accounts").select("smtp_status, imap_status, last_test_at").eq("is_default", true).maybeSingle(),
    supabase.from("user_sessions").select("id", { count: "exact", head: true }).eq("status", "active").gte("last_seen_at", week),
    supabase.from("login_events").select("id", { count: "exact", head: true }).eq("event", "login_failed").gte("occurred_at", day),
    supabase.from("security_events").select("id", { count: "exact", head: true }).eq("severity", "critical").gte("occurred_at", week),
    supabase.from("login_events").select("id, occurred_at, event, email, user_id, ip, browser, os").in("event", ["login_success", "otp_verified"]).order("occurred_at", { ascending: false }).limit(12),
    supabase.from("login_events").select("id, occurred_at, event, email, user_id, ip, browser, os").in("event", ["login_failed", "login_locked", "otp_failed", "otp_locked"]).order("occurred_at", { ascending: false }).limit(12),
    supabase.from("security_events").select("id, occurred_at, event_type, severity, summary, actor_id, target_user_id").order("occurred_at", { ascending: false }).limit(15),
    supabase.from("profiles").select("id, full_name"),
    hasPermission(session, P.auditView)
      ? supabase.from("app_error_logs").select("id, occurred_at, digest, message, path, route_path").order("occurred_at", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] }),
  ])
  const names = new Map((profiles.data ?? []).map((p) => [p.id as string, p.full_name as string]))
  const withUser = (rows: (LoginEventRow & { user_id?: string | null })[] | null) =>
    (rows ?? []).map((r) => ({ ...r, user: r.user_id && names.get(r.user_id) ? { full_name: names.get(r.user_id)! } : null }))

  const https = (process.env.APP_URL ?? "").startsWith("https://") || process.env.NODE_ENV !== "production"
  const otpMode = policy.data?.otp_mode ?? "disabled"
  const checks: { key: string; level: Level; href?: string }[] = [
    { key: "https", level: https ? "secure" : "action" },
    { key: "encryption", level: isEncryptionConfigured() ? "secure" : "action" },
    { key: "serviceKey", level: isServiceRoleConfigured() ? "secure" : "action" },
    { key: "email", level: account.data?.smtp_status === "ok" ? "secure" : account.data ? "action" : "warning", href: "/admin/email" },
    { key: "otp", level: otpMode === "disabled" ? "warning" : "secure", href: "/admin/authentication" },
    { key: "failedLogins", level: (failed24.count ?? 0) >= 20 ? "action" : (failed24.count ?? 0) >= 5 ? "warning" : "secure" },
    { key: "criticalEvents", level: (critical7.count ?? 0) > 0 ? "warning" : "secure" },
    { key: "backups", level: "warning" },
  ]
  const overall: Level = checks.some((c) => c.level === "action") ? "action" : checks.some((c) => c.level === "warning") ? "warning" : "secure"
  const levelStyle: Record<Level, string> = {
    secure: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    action: "bg-destructive/12 text-destructive",
  }
  const LevelIcon = { secure: CheckCircle2, warning: AlertTriangle, action: ShieldX }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <section className={cn("flex items-center gap-4 rounded-xl border p-5", levelStyle[overall])}>
        {overall === "secure" ? <ShieldCheck className="size-8" /> : <ShieldAlert className="size-8" />}
        <div>
          <p className="text-lg font-semibold">{t(`overall.${overall}`)}</p>
          <p className="text-sm opacity-80">{t(`overallHint.${overall}`)}</p>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("activeSessions")} value={activeSessions.count ?? 0} icon={MonitorSmartphone} href={hasPermission(session, P.sessionsView) ? "/admin/sessions" : undefined} />
        <StatCard label={t("failedLogins24h")} value={failed24.count ?? 0} icon={ShieldX} tone={(failed24.count ?? 0) > 0 ? "waiting" : "muted"} />
        <StatCard label={t("criticalEvents7d")} value={critical7.count ?? 0} icon={ShieldAlert} tone={(critical7.count ?? 0) > 0 ? "waiting" : "muted"} />
        <StatCard label={t("otpStatus")} value={t(`otpMode.${otpMode}`)} icon={ShieldCheck} tone={otpMode === "disabled" ? "muted" : "done"} href="/admin/authentication" />
      </div>

      <SectionCard title={t("checks")} icon={Activity} bodyClassName="p-0">
        <ul className="divide-y">
          {checks.map((c) => {
            const Icon = LevelIcon[c.level]
            const body = (
              <div className="flex items-start gap-3 px-4 py-3">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", levelStyle[c.level])}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t(`check.${c.key}.title`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`check.${c.key}.${c.level}`)}</p>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", levelStyle[c.level])}>{t(`level.${c.level}`)}</span>
              </div>
            )
            return <li key={c.key}>{c.href ? <Link href={c.href} className="block hover:bg-muted/40">{body}</Link> : body}</li>
          })}
        </ul>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title={t("recentLogins")} icon={History} bodyClassName="p-0">
          <LoginActivity events={withUser(logins.data as LoginEventRow[])} showUser />
        </SectionCard>
        <SectionCard title={t("failedAttempts")} icon={ShieldX} bodyClassName="p-0">
          <LoginActivity events={withUser(failures.data as LoginEventRow[])} showUser />
        </SectionCard>
      </div>

      <SectionCard title={t("recentEvents")} icon={ShieldAlert} bodyClassName="p-0">
        <SecurityEventList
          events={((events.data ?? []) as SecurityEventRow[]).map((e) => ({
            ...e,
            actor_name: e.actor_id ? (names.get(e.actor_id) ?? null) : null,
            target_name: e.target_user_id ? (names.get(e.target_user_id) ?? null) : null,
          }))}
        />
      </SectionCard>

      {hasPermission(session, P.auditView) && (
        <SectionCard title={t("serverErrors")} icon={AlertTriangle} bodyClassName="p-0">
          {(serverErrors.data ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("noServerErrors")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {(serverErrors.data as { id: number; occurred_at: string; digest: string | null; message: string | null; path: string | null; route_path: string | null }[]).map((e) => (
                <li key={e.id} className="space-y-0.5 px-4 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{e.digest ?? "—"}</span>
                    <span dir="ltr">{e.path}</span>
                    <span>{new Date(e.occurred_at).toLocaleString("en-GB", { timeZone: "Asia/Amman" })}</span>
                  </p>
                  <p className="font-mono text-xs break-words" dir="ltr">
                    {e.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <p className="text-xs text-muted-foreground">{t("infraNote")}</p>
    </div>
  )
}
