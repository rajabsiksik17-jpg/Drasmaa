"use client"

import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, KeyRound, LogIn, LogOut, MailCheck, ShieldAlert, ShieldX, type LucideIcon } from "lucide-react"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

export interface LoginEventRow {
  id: number
  occurred_at: string
  event: string
  email?: string | null
  ip: string | null
  browser: string | null
  os: string | null
  device_type?: string | null
  reason?: string | null
  user?: { full_name: string } | null
}

const ICON: Record<string, LucideIcon> = {
  login_success: LogIn,
  session_started: LogIn,
  login_failed: ShieldX,
  login_locked: ShieldAlert,
  logout: LogOut,
  otp_sent: MailCheck,
  otp_verified: CheckCircle2,
  otp_failed: ShieldX,
  otp_expired: ShieldX,
  otp_locked: ShieldAlert,
  session_revoked: LogOut,
  password_changed: KeyRound,
  password_reset_requested: KeyRound,
}
const BAD = new Set(["login_failed", "login_locked", "otp_failed", "otp_expired", "otp_locked"])

export function LoginActivity({ events, showUser = false }: { events: LoginEventRow[]; showUser?: boolean }) {
  const t = useTranslations("sessions")
  const locale = useLocale()
  if (events.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("noActivity")}</p>
  return (
    <ul className="divide-y">
      {events.map((e) => {
        const Icon = ICON[e.event] ?? LogIn
        const bad = BAD.has(e.event)
        return (
          <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
            <Icon className={cn("mt-0.5 size-4 shrink-0", bad ? "text-destructive" : "text-muted-foreground")} />
            <div className="min-w-0 flex-1 text-sm">
              <p className={cn("font-medium", bad && "text-destructive")}>
                {t(`events.${e.event}`)}
                {showUser && (e.user?.full_name || e.email) && (
                  <span className="ms-2 font-normal text-muted-foreground" dir="auto">
                    {e.user?.full_name ?? e.email}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(e.occurred_at, locale)}
                {(e.browser || e.os) && ` · ${[e.browser, e.os].filter(Boolean).join(" / ")}`}
                {e.ip && (
                  <>
                    {" · "}
                    <span dir="ltr">{e.ip}</span>
                  </>
                )}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
