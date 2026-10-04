"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { timelineHref, TIMELINE_ICONS } from "@/components/patients/patient-timeline"
import { formatDateLong, formatTime, isoToClinicParts } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { TimelineEvent } from "@/types/db"

const GROUPS = {
  visits: ["clinic_visit", "checked_out", "visit"],
  appointments: ["appointment", "checked_in"],
  cases: ["fertility_case", "pregnancy_case", "oi_cycle_started", "oi_cycle_completed"],
  files: ["document", "generated_document", "drawing"],
  clinical: ["prescription", "medical_report"],
  billing: ["invoice", "payment"],
} as const satisfies Record<string, readonly TimelineEvent["event_type"][]>
type Group = keyof typeof GROUPS | "all"
const PAGE = 40

/**
 * The patient's whole story — appointments, clinic visits, cases, files,
 * ultrasounds, prescriptions, reports, invoices and payments — grouped by
 * day, filterable, each entry expandable (no giant page).
 */
export function UnifiedTimeline({ patientId, events, people }: { patientId: string; events: TimelineEvent[]; people: Record<string, string> }) {
  const t = useTranslations("timeline")
  const locale = useLocale()
  const [group, setGroup] = useState<Group>("all")
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)

  const filtered = useMemo(
    () => (group === "all" ? events : events.filter((e) => (GROUPS[group] as readonly string[]).includes(e.event_type))),
    [events, group],
  )
  const days = useMemo(() => {
    const out: { day: string; items: TimelineEvent[] }[] = []
    for (const e of filtered.slice(0, shown)) {
      const day = isoToClinicParts(e.occurred_at).date
      const last = out.at(-1)
      if (last?.day === day) last.items.push(e)
      else out.push({ day, items: [e] })
    }
    return out
  }, [filtered, shown])
  const count = (g: Group) => (g === "all" ? events.length : events.filter((e) => (GROUPS[g] as readonly string[]).includes(e.event_type)).length)

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist">
        {(["all", ...Object.keys(GROUPS)] as Group[]).map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={group === g}
            onClick={() => {
              setGroup(g)
              setShown(PAGE)
            }}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm", group === g ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
          >
            {t(`filters.${g}`)}
            <span className={cn("rounded-full px-1.5 text-xs tabular-nums", group === g ? "bg-primary-foreground/20" : "bg-muted")}>{count(g)}</span>
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        days.map(({ day, items }) => (
          <section key={day}>
            <h3 className="sticky top-[7.5rem] z-[1] mb-2 inline-block rounded-full bg-muted px-3 py-0.5 text-xs font-semibold">{formatDateLong(day, locale)}</h3>
            <ol className="relative space-y-2 border-s ps-4">
              {items.map((e) => {
                const key = `${e.event_type}-${e.entity_id}-${e.occurred_at}`
                const { icon: Icon, tone } = TIMELINE_ICONS[e.event_type] ?? TIMELINE_ICONS.document
                const sub = e.subtype ? (t.has(`subtype.${e.subtype}`) ? t(`subtype.${e.subtype}`) : e.subtype) : ""
                const status = e.status ? (t.has(`status.${e.status}`) ? t(`status.${e.status}`) : e.status) : ""
                const expanded = open === key
                return (
                  <li key={key} className="relative">
                    <span className={cn("absolute -start-[29px] top-2.5 grid size-6 place-items-center rounded-full ring-4 ring-background", tone)}>
                      <Icon className="size-3.5" />
                    </span>
                    <div className={cn("rounded-xl border bg-card shadow-xs transition", expanded && "ring-1 ring-primary/30")}>
                      <button type="button" onClick={() => setOpen(expanded ? null : key)} className="flex w-full items-start gap-3 p-3 text-start" aria-expanded={expanded}>
                        <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{formatTime(e.occurred_at, locale)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t(`kind.${e.event_type}`)}</span>
                          <span className="block text-sm font-medium">
                            {t(`event.${e.event_type}`, { number: e.number ?? "" })}
                            {sub && <span className="font-normal text-muted-foreground"> · {sub}</span>}
                          </span>
                          {status && <span className="mt-0.5 inline-block rounded-full bg-muted px-2 text-[11px]">{status}</span>}
                        </span>
                        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                      </button>
                      {expanded && (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                          <span>
                            {t("by", { who: (e.actor_id && people[e.actor_id]) || "—" })} · {formatDateLong(isoToClinicParts(e.occurred_at).date, locale)} {formatTime(e.occurred_at, locale)}
                          </span>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={timelineHref(patientId, e)}>
                              <ExternalLink />
                              {t("open")}
                            </Link>
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        ))
      )}
      {filtered.length > shown && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            {t("more")}
          </Button>
        </div>
      )}
    </div>
  )
}
