"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { CalendarPlus, DoorOpen, UserPlus } from "lucide-react"
import { useCan } from "@/components/app-context"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const AppointmentDialog = dynamic(() => import("@/components/appointments/appointment-dialog").then((m) => m.AppointmentDialog), { ssr: false })
const WalkInDialog = dynamic(() => import("@/components/encounters/walk-in-dialog").then((m) => m.WalkInDialog), { ssr: false })

const tile =
  "group flex min-h-16 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-start shadow-xs transition hover:border-primary/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** The three front-desk starts: new patient, new appointment (planned), new visit (here now). */
export function DashboardQuickActions() {
  const t = useTranslations("dashboard.quick")
  const can = useCan()
  const [dialog, setDialog] = useState<"appointment" | "visit" | null>(null)
  const icon = (Icon: typeof UserPlus, tone: string) => (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg transition group-hover:scale-105", tone)}>
      <Icon className="size-5" />
    </span>
  )
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        {can(P.patientsCreate) && (
          <Link href="/patients/new" className={tile}>
            {icon(UserPlus, "bg-primary/10 text-primary")}
            <span className="min-w-0">
              <span className="block font-semibold">{t("newPatient")}</span>
              <span className="block truncate text-xs text-muted-foreground">{t("newPatientHint")}</span>
            </span>
          </Link>
        )}
        {can(P.appointmentsCreate) && (
          <button type="button" className={tile} onClick={() => setDialog("appointment")}>
            {icon(CalendarPlus, "bg-sky-500/12 text-sky-700 dark:text-sky-300")}
            <span className="min-w-0">
              <span className="block font-semibold">{t("newAppointment")}</span>
              <span className="block truncate text-xs text-muted-foreground">{t("newAppointmentHint")}</span>
            </span>
          </button>
        )}
        {can(P.encountersCreate) && (
          <button type="button" className={tile} onClick={() => setDialog("visit")}>
            {icon(DoorOpen, "bg-status-waiting/15 text-status-waiting")}
            <span className="min-w-0">
              <span className="block font-semibold">{t("newVisit")}</span>
              <span className="block truncate text-xs text-muted-foreground">{t("newVisitHint")}</span>
            </span>
          </button>
        )}
      </div>
      {dialog === "appointment" && <AppointmentDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "visit" && <WalkInDialog open onOpenChange={(o) => !o && setDialog(null)} />}
    </>
  )
}
