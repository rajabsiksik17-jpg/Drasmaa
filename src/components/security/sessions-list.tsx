"use client"


import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Laptop, Loader2, LogOut, Monitor, ShieldCheck, Smartphone, Tablet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useActionError } from "@/hooks/use-action-error"
import { revokeSession, signOutOtherSessions } from "@/lib/actions/security"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface SessionRow {
  id: string
  user_id: string
  status: "pending_otp" | "active" | "revoked" | "signed_out"
  auth_method: string
  otp_verified_at: string | null
  ip: string | null
  browser: string | null
  os: string | null
  device_type: string | null
  created_at: string
  last_seen_at: string
  ended_at: string | null
  user?: { full_name: string; email: string | null } | null
}

const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Laptop } as Record<string, typeof Monitor>

export function SessionsList({
  sessions,
  currentSessionId,
  canRevokeOthers,
  showUser = false,
  showSignOutOthers = false,
}: {
  sessions: SessionRow[]
  currentSessionId: string | null
  canRevokeOthers: boolean
  showUser?: boolean
  showSignOutOthers?: boolean
}) {
  const t = useTranslations("sessions")
  const locale = useLocale()
  const router = useRouter()
  const { message } = useActionError()
  const [pending, start] = useSafeTransition()

  const revoke = (id: string) =>
    start(async () => {
      const res = await revokeSession(id)
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("revoked"))
      router.refresh()
    })

  const others = () =>
    start(async () => {
      const res = await signOutOtherSessions()
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("othersSignedOut", { count: res.data.count }))
      router.refresh()
    })

  const live = sessions.filter((s) => s.status === "active" || s.status === "pending_otp")
  const ordered = [...sessions].sort((a, b) => Number(b.id === currentSessionId) - Number(a.id === currentSessionId))

  return (
    <div className="space-y-3">
      {showSignOutOthers && live.some((s) => s.id !== currentSessionId) && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={others} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <LogOut className="rtl:-scale-x-100" />}
            {t("signOutOthers")}
          </Button>
        </div>
      )}
      <ul className="divide-y rounded-xl border bg-card">
        <AnimatePresence initial={false}>
          {ordered.map((s) => {
            const Icon = DEVICE_ICON[s.device_type ?? "desktop"] ?? Monitor
            const current = s.id === currentSessionId
            const active = s.status === "active" || s.status === "pending_otp"
            return (
              <motion.li key={s.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {showUser && s.user && <span>{s.user.full_name}</span>}
                    <span className={cn(showUser && "text-muted-foreground")}>
                      {[s.browser, s.os].filter(Boolean).join(" · ") || t("unknownDevice")}
                    </span>
                    {current && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">{t("current")}</span>}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        s.status === "active"
                          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                          : s.status === "pending_otp"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {t(`status.${s.status}`)}
                    </span>
                    {s.otp_verified_at && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ShieldCheck className="size-3" />
                        OTP
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("created", { date: formatDateTime(s.created_at, locale) })} · {t("lastActive", { date: formatDateTime(s.last_seen_at, locale) })}
                    {s.ip && (
                      <>
                        {" "}
                        · <span dir="ltr">{s.ip}</span>
                      </>
                    )}
                  </p>
                </div>
                {active && !current && (canRevokeOthers || !showUser) && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revoke(s.id)} disabled={pending}>
                    <LogOut className="rtl:-scale-x-100" />
                    {t("revoke")}
                  </Button>
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
        {sessions.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{t("none")}</li>}
      </ul>
    </div>
  )
}
