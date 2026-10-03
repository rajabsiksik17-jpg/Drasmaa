"use client"

import { useLocale, useTranslations } from "next-intl"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

export interface SecurityEventRow {
  id: number
  occurred_at: string
  event_type: string
  severity: "info" | "warning" | "critical"
  summary: string
  actor_id: string | null
  target_user_id: string | null
  actor_name?: string | null
  target_name?: string | null
}

export function SecurityEventList({ events }: { events: SecurityEventRow[] }) {
  const t = useTranslations("securityCenter")
  const locale = useLocale()
  if (events.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("noEvents")}</p>
  return (
    <ul className="divide-y">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              e.severity === "critical" ? "bg-destructive" : e.severity === "warning" ? "bg-amber-500" : "bg-muted-foreground/40",
            )}
            aria-label={t(`severity.${e.severity}`)}
          />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">{t.has(`eventTypes.${e.event_type}`) ? t(`eventTypes.${e.event_type}`) : e.summary}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(e.occurred_at, locale)}
              {e.actor_name && ` · ${t("by", { name: e.actor_name })}`}
              {e.target_name && e.target_name !== e.actor_name && ` · ${t("forUser", { name: e.target_name })}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
