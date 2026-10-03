"use client"

import { useOptimistic, useTransition } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AlarmClock, BellRing, Lock, Mail, MessageCircle, MonitorSmartphone } from "lucide-react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { saveNotificationEvent, saveReminderRule } from "@/lib/actions/security"
import { cn } from "@/lib/utils"

export interface EventTypeRow {
  code: string
  category: string
  default_priority: "low" | "normal" | "high" | "critical"
  name_en: string
  name_ar: string
  in_app_enabled: boolean
  email_enabled: boolean
  is_critical: boolean
  sort_order: number
}

export interface ReminderRuleRow {
  id: string
  offset_minutes: number
  channel: "in_app" | "email" | "whatsapp_prepare"
  enabled: boolean
}

const CHANNELS: ReminderRuleRow["channel"][] = ["in_app", "email", "whatsapp_prepare"]
const CHANNEL_ICON = { in_app: MonitorSmartphone, email: Mail, whatsapp_prepare: MessageCircle }

export function NotificationSettings({ events, rules, emailReady }: { events: EventTypeRow[]; rules: ReminderRuleRow[]; emailReady: boolean }) {
  const t = useTranslations("notificationSettings")
  const tn = useTranslations("notifications")
  const locale = useLocale()
  const { message } = useActionError()
  const [, start] = useTransition()
  const [eventState, setEvent] = useOptimistic(events, (state, patch: Partial<EventTypeRow> & { code: string }) =>
    state.map((e) => (e.code === patch.code ? { ...e, ...patch } : e)),
  )
  const [ruleState, setRule] = useOptimistic(rules, (state, patch: { id: string; enabled: boolean }) =>
    state.map((r) => (r.id === patch.id ? { ...r, enabled: patch.enabled } : r)),
  )

  const toggleEvent = (e: EventTypeRow, patch: Partial<Pick<EventTypeRow, "in_app_enabled" | "email_enabled">>) =>
    start(async () => {
      setEvent({ code: e.code, ...patch })
      const res = await saveNotificationEvent({
        code: e.code,
        in_app_enabled: patch.in_app_enabled ?? e.in_app_enabled,
        email_enabled: patch.email_enabled ?? e.email_enabled,
      })
      if (!res.ok) toast.error(message(res.error))
    })

  const toggleRule = (r: ReminderRuleRow, enabled: boolean) =>
    start(async () => {
      setRule({ id: r.id, enabled })
      const res = await saveReminderRule({ id: r.id, enabled })
      if (!res.ok) toast.error(message(res.error))
    })

  const offsets = [...new Set(ruleState.map((r) => r.offset_minutes))].sort((a, b) => b - a)
  const offsetLabel = (m: number) => (m >= 1440 ? t("hoursBefore", { hours: m / 60 }) : m >= 60 ? t("hoursBefore", { hours: m / 60 }) : t("minutesBefore", { minutes: m }))
  const categories = [...new Set(eventState.map((e) => e.category))]

  return (
    <div className="space-y-5">
      <SectionCard title={t("reminders")} icon={AlarmClock}>
        <p className="mb-3 text-sm text-muted-foreground">{t("remindersHint")}</p>
        {!emailReady && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t("emailNotReady")}{" "}
            <Link href="/admin/email" className="font-medium underline">
              {t("configureEmail")}
            </Link>
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-2 text-start font-medium">{t("timing")}</th>
                {CHANNELS.map((c) => {
                  const Icon = CHANNEL_ICON[c]
                  return (
                    <th key={c} className="py-2 text-center font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="size-3.5" />
                        {t(`channel.${c}`)}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y">
              {offsets.map((m) => (
                <tr key={m}>
                  <td className="py-2.5 font-medium">{offsetLabel(m)}</td>
                  {CHANNELS.map((c) => {
                    const r = ruleState.find((x) => x.offset_minutes === m && x.channel === c)
                    return (
                      <td key={c} className="py-2.5 text-center">
                        {r ? (
                          <Switch checked={r.enabled} onCheckedChange={(v) => toggleRule(r, v)} aria-label={`${offsetLabel(m)} — ${t(`channel.${c}`)}`} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("whatsappNote")}</p>
      </SectionCard>

      <SectionCard title={t("events")} icon={BellRing} bodyClassName="p-0">
        <p className="px-4 pt-3 text-sm text-muted-foreground">{t("eventsHint")}</p>
        {categories.map((cat) => (
          <div key={cat} className="mt-3">
            <p className="bg-muted/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground">{tn(`category.${cat}`)}</p>
            <ul className="divide-y">
              {eventState
                .filter((e) => e.category === cat)
                .map((e) => (
                  <li key={e.code} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {locale === "ar" ? e.name_ar : e.name_en}
                        <span
                          className={cn(
                            "rounded px-1.5 py-px text-[10px] font-semibold",
                            e.default_priority === "critical"
                              ? "bg-destructive text-white"
                              : e.default_priority === "high"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {tn(`priority.${e.default_priority}`)}
                        </span>
                        {e.is_critical && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Lock className="size-3" />
                            {t("alwaysOn")}
                          </span>
                        )}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <MonitorSmartphone className="size-3.5 text-muted-foreground" />
                      {t("inApp")}
                      <Switch checked={e.in_app_enabled} disabled={e.is_critical} onCheckedChange={(v) => toggleEvent(e, { in_app_enabled: v })} />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Mail className="size-3.5 text-muted-foreground" />
                      {t("email")}
                      <Switch checked={e.email_enabled} onCheckedChange={(v) => toggleEvent(e, { email_enabled: v })} />
                    </label>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}
