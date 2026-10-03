"use client"

import { useState } from "react"
import { useNow } from "@/hooks/use-hydration"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Hourglass, Play, Stethoscope, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StartVisitDialog, appointmentTypeToVisit } from "@/components/visits/start-visit-dialog"
import { useRefs } from "@/components/app-context"
import { ageFromDob, formatTime } from "@/lib/dates"
import type { AppointmentWithRefs } from "@/types/db"

// null until hydrated: the server never renders a wall-clock-dependent value.
function useMinutesSince(iso: string | null): number | null {
  const now = useNow(30_000)
  if (now == null || !iso) return null
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
}

function QueueItem({ a, index, onStart }: { a: AppointmentWithRefs; index: number; onStart: () => void }) {
  const t = useTranslations("dashboard")
  const locale = useLocale()
  const refs = useRefs()
  const waited = useMinutesSince(a.checked_in_at)
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="flex items-center gap-3 rounded-lg border bg-card p-3"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-status-waiting/15 text-sm font-semibold text-[color:oklch(0.45_0.12_70)] dark:text-status-waiting">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/patients/${a.patient_id}`} className="block truncate font-medium hover:text-primary">
          {a.patient?.full_name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {a.patient?.patient_code}
          {a.patient?.dob ? ` · ${ageFromDob(a.patient.dob)}y` : ""} · {refs.optionLabel("appointment_type", a.visit_type)} ·{" "}
          {formatTime(a.scheduled_at, locale)}
        </p>
      </div>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:inline">{waited != null && t("waitingFor", { minutes: waited })}</span>
      <Button size="sm" variant="outline" asChild>
        <Link href={`/patients/${a.patient_id}`}>
          <UserRound />
          <span className="sr-only sm:not-sr-only">{t("open")}</span>
        </Link>
      </Button>
      <Button size="sm" onClick={onStart}>
        <Play className="rtl:-scale-x-100" />
        <span className="sr-only sm:not-sr-only">{t("startVisit")}</span>
      </Button>
    </motion.li>
  )
}

/** Live waiting room for the doctor (fed by realtime refresh of the page). */
export function DoctorQueue({ waiting, current }: { waiting: AppointmentWithRefs[]; current: AppointmentWithRefs[] }) {
  const t = useTranslations("dashboard")
  const [starting, setStarting] = useState<AppointmentWithRefs | null>(null)
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <div className="rounded-xl border bg-card shadow-xs">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Hourglass className="size-4 text-status-waiting" />
            {t("queue")}
          </h2>
          <motion.span key={waiting.length} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="rounded-full bg-status-waiting/15 px-2 text-xs font-semibold tabular-nums">
            {waiting.length}
          </motion.span>
        </header>
        <div className="p-3">
          {waiting.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("queueEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {waiting.map((a, i) => (
                  <QueueItem key={a.id} a={a} index={i} onStart={() => setStarting(a)} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>
      <div className="rounded-xl border bg-card shadow-xs">
        <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <Stethoscope className="size-4 text-status-with-doctor" />
          {t("currentPatient")}
        </header>
        <div className="p-3">
          {current.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noCurrent")}</p>
          ) : (
            <ul className="space-y-2">
              {current.map((a) => (
                <li key={a.id} className="rounded-lg border border-status-with-doctor/30 bg-status-with-doctor/5 p-3">
                  <p className="font-medium">{a.patient?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{a.patient?.patient_code}</p>
                  <Button size="sm" className="mt-2" onClick={() => setStarting(a)}>
                    <Play className="rtl:-scale-x-100" />
                    {t("continueVisit")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {starting && (
        <StartVisitDialog
          open={!!starting}
          onOpenChange={(o) => !o && setStarting(null)}
          patientId={starting.patient_id}
          appointmentId={starting.id}
          suggested={appointmentTypeToVisit(starting.visit_type)}
        />
      )}
    </section>
  )
}
