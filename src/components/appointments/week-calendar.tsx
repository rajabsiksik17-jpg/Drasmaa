"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRefs } from "@/components/app-context"
import { addDaysIso, clinicToday, formatTime, formatWeekday, isoToClinicParts } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { AppointmentWithRefs } from "@/types/db"

const HOUR_PX = 56

/** Week view (Saturday-first, clinic timezone). Scrolls horizontally on small screens. */
export function WeekCalendar({ weekStart, rows }: { weekStart: string; rows: AppointmentWithRefs[] }) {
  const t = useTranslations("appointments")
  const locale = useLocale()
  const refs = useRefs()
  const params = useSearchParams()
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i))
  const today = clinicToday()
  const startHour = Number(refs.settings.working_hours_start.slice(0, 2)) || 8
  const endHour = Math.max(startHour + 1, Number(refs.settings.working_hours_end.slice(0, 2)) || 18)
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)

  const weekHref = (offset: number) => {
    const next = new URLSearchParams(params)
    next.set("week", addDaysIso(weekStart, offset))
    return `?${next.toString()}`
  }

  const byDay = new Map<string, AppointmentWithRefs[]>()
  for (const r of rows) {
    const d = isoToClinicParts(r.scheduled_at).date
    byDay.set(d, [...(byDay.get(d) ?? []), r])
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={weekHref(-7)} aria-label={t("prevWeek")}><ChevronLeft className="rtl:-scale-x-100" /></Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={(() => { const n = new URLSearchParams(params); n.delete("week"); return `?${n.toString()}` })()}>{t("thisWeek")}</Link>
        </Button>
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={weekHref(7)} aria-label={t("nextWeek")}><ChevronRight className="rtl:-scale-x-100" /></Link>
        </Button>
        <span className="ms-2 text-sm font-medium">
          {formatWeekday(days[0], locale)} – {formatWeekday(days[6], locale)}
        </span>
      </div>
      <div className="scroll-x rounded-xl border bg-card">
        <div className="grid min-w-[860px]" style={{ gridTemplateColumns: `56px repeat(7, minmax(0, 1fr))` }}>
          <div className="sticky top-0 border-b bg-card" />
          {days.map((d) => (
            <div key={d} className={cn("border-b border-s px-2 py-2 text-center text-xs font-medium", d === today && "bg-primary/5 text-primary")}>
              {formatWeekday(d, locale)}
              <span className="ms-1 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{byDay.get(d)?.filter((a) => a.status !== "cancelled").length ?? 0}</span>
            </div>
          ))}
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="pe-1 text-end text-[10px] text-muted-foreground" style={{ height: HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={cn("relative border-s", d === today && "bg-primary/[0.025]")} style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => (
                <div key={h} className="border-b border-dashed border-border/60" style={{ height: HOUR_PX }} />
              ))}
              {(byDay.get(d) ?? []).map((a) => {
                const { time } = isoToClinicParts(a.scheduled_at)
                const [hh, mm] = time.split(":").map(Number)
                const top = ((hh - startHour) * 60 + mm) * (HOUR_PX / 60)
                const height = Math.max(22, a.duration_minutes * (HOUR_PX / 60) - 2)
                if (top < 0 || top > hours.length * HOUR_PX) return null
                return (
                  <Link
                    key={a.id}
                    href={`/patients/${a.patient_id}`}
                    className={cn(
                      "absolute inset-x-1 overflow-hidden rounded-md border-s-[3px] bg-primary/10 px-1.5 py-0.5 text-[11px] leading-tight shadow-xs transition hover:z-10 hover:shadow-md",
                      a.status === "checked_in" && "bg-status-waiting/20",
                      a.status === "with_doctor" && "bg-status-with-doctor/15",
                      a.status === "completed" && "bg-status-completed/15",
                      (a.status === "cancelled" || a.status === "no_show") && "bg-muted line-through opacity-60",
                    )}
                    style={{ top, height, borderInlineStartColor: a.doctor?.color ?? "var(--primary)" }}
                    title={`${a.patient?.full_name} · ${formatTime(a.scheduled_at, locale)}`}
                  >
                    <span className="block truncate font-medium">{a.patient?.full_name}</span>
                    <span className="block truncate text-muted-foreground">
                      {formatTime(a.scheduled_at, locale)} · {refs.optionLabel("appointment_type", a.visit_type)}
                    </span>
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
