"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { formatDistance } from "date-fns"
import { arSA, enGB } from "date-fns/locale"
import {
  AlarmClock,
  Bell,
  BellRing,
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  CheckCheck,
  FlaskConical,
  KeyRound,
  LogIn,
  MailWarning,
  MessageCircle,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  UserCog,
  UserPlus,
  UserRoundX,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useNotifications } from "@/components/notifications/notifications-provider"
import { useNotificationText } from "@/components/notifications/notification-text"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/dates"
import { useNow } from "@/hooks/use-hydration"
import type { AppNotification, NotificationPriority, NotificationType } from "@/types/db"

export const NOTIFICATION_ICONS: Record<NotificationType, LucideIcon> = {
  appointment_created: CalendarPlus,
  appointment_approaching: AlarmClock,
  appointment_reminder: CalendarClock,
  appointment_cancelled: CalendarX2,
  appointment_rescheduled: CalendarClock,
  patient_checked_in: UserCheck,
  appointment_missed: UserRoundX,
  whatsapp_reminder_ready: MessageCircle,
  patient_registered: UserPlus,
  patient_assigned: Stethoscope,
  pregnancy_followup_due: CalendarClock,
  fertility_followup_due: CalendarClock,
  investigation_uploaded: FlaskConical,
  user_created: UserPlus,
  user_status_changed: UserCog,
  permission_changed: KeyRound,
  doctor_added: Stethoscope,
  doctor_removed: Stethoscope,
  config_changed: Settings2,
  new_login: LogIn,
  otp_verified: ShieldCheck,
  login_failed: ShieldAlert,
  session_revoked: ShieldAlert,
  password_changed: KeyRound,
  security_config_changed: ShieldAlert,
  email_failure: MailWarning,
  system: BellRing,
}

/** Calm by default; only high/critical stand out (critical = security red). */
const PRIORITY_TONE: Record<NotificationPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-primary/10 text-primary",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  critical: "bg-destructive/15 text-destructive",
}

export function NotificationBell() {
  const t = useTranslations("notifications")
  const { items, unread, unreadCritical, pulse, markAllRead } = useNotifications()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("open", { count: unread })}>
          <motion.span key={pulse} animate={pulse ? { rotate: [0, -14, 12, -8, 6, 0] } : undefined} transition={{ duration: 0.6 }}>
            <Bell />
          </motion.span>
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                key="badge"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className={cn(
                  "absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-white",
                  unreadCritical > 0 ? "bg-destructive animate-pulse-ring" : "bg-primary",
                )}
              >
                {unread > 99 ? "99+" : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(94vw,400px)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">
            {t("title")}
            {unread > 0 && <span className="ms-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{unread}</span>}
          </span>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => void markAllRead()}>
              <CheckCheck />
              {t("markAll")}
            </Button>
          )}
        </div>
        <NotificationList items={items.slice(0, 8)} compact />
        <div className="border-t p-1.5">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/notifications">{t("viewAll")}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function NotificationList({ items, compact = false }: { items: AppNotification[]; compact?: boolean }) {
  const t = useTranslations("notifications")
  const locale = useLocale()
  // Deterministic absolute time on the server/hydration; relative time after.
  const now = useNow(60_000)
  const { open } = useNotifications()
  const text = useNotificationText()
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
        <Bell className="size-8 opacity-30" />
        {t("empty")}
      </div>
    )
  }
  return (
    <ul className={cn("divide-y", compact && "max-h-[26rem] overflow-y-auto")}>
      <AnimatePresence initial={false}>
        {items.map((n) => {
          const Icon = NOTIFICATION_ICONS[n.type] ?? Bell
          const { title, body } = text(n)
          const priority = n.priority ?? "normal"
          const critical = priority === "critical"
          return (
            <motion.li
              key={n.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <button
                onClick={() => open(n)}
                className={cn(
                  "relative flex w-full gap-3 px-3 py-2.5 text-start transition hover:bg-muted/60",
                  !n.read_at && "bg-primary/[0.04]",
                  critical && !n.read_at && "bg-destructive/[0.06]",
                )}
              >
                {critical && <span aria-hidden className="absolute inset-y-0 start-0 w-0.5 bg-destructive" />}
                <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", PRIORITY_TONE[priority])}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-sm", !n.read_at && "font-semibold")}>{title}</span>
                    {(priority === "high" || critical) && (
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 py-px text-[10px] font-semibold",
                          critical ? "bg-destructive text-white" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {t(`priority.${priority}`)}
                      </span>
                    )}
                    {!n.read_at && <span className="ms-auto size-1.5 shrink-0 rounded-full bg-primary" aria-label={t("unread")} />}
                  </span>
                  {body && <span className="line-clamp-2 text-xs text-muted-foreground">{body}</span>}
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                    <span>{t(`category.${n.category ?? "system"}`)}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {now == null
                        ? formatDateTime(n.created_at, locale)
                        : formatDistance(new Date(n.created_at), now, { addSuffix: true, locale: locale === "ar" ? arSA : enGB })}
                    </span>
                  </span>
                </span>
              </button>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
