"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { CalendarX2 } from "lucide-react"
import { AppointmentActions } from "@/components/appointments/appointment-actions"
import { AppointmentStatusBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/page"
import { useRefs } from "@/components/app-context"
import { ageFromDob, formatDateLong, formatTime, isoToClinicParts } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { AppointmentWithRefs } from "@/types/db"

/**
 * Appointment list: a real table on tablet/desktop, stacked cards on phones.
 * Rows animate when their status changes in realtime.
 */
export function AppointmentList({
  rows,
  showDate = false,
  emptyTitle,
  emptyDescription,
  emptyAction,
  hideDoctor = false,
}: {
  rows: AppointmentWithRefs[]
  showDate?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  hideDoctor?: boolean
}) {
  const t = useTranslations("appointments")
  const locale = useLocale()
  const refs = useRefs()

  if (rows.length === 0) {
    return <EmptyState icon={CalendarX2} title={emptyTitle ?? t("empty")} description={emptyDescription} action={emptyAction} />
  }

  const doctorName = (a: AppointmentWithRefs) =>
    a.doctor ? (locale === "ar" && a.doctor.display_name_ar ? a.doctor.display_name_ar : a.doctor.display_name_en) : ""
  const deptName = (a: AppointmentWithRefs) =>
    a.department ? (locale === "ar" ? a.department.name_ar : a.department.name_en) : ""

  return (
    <>
      {/* Tablet / desktop */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{showDate ? t("dateTime") : t("time")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("patient")}</th>
              {!hideDoctor && <th className="px-4 py-2.5 text-start font-medium">{t("doctor")}</th>}
              <th className="hidden px-4 py-2.5 text-start font-medium lg:table-cell">{t("department")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("visitType")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("status")}</th>
              <th className="px-4 py-2.5 text-end font-medium">
                <span className="sr-only">{t("actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((a) => (
                <motion.tr
                  key={a.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    "border-t transition-colors hover:bg-muted/30",
                    a.status === "checked_in" && "bg-status-waiting/[0.06]",
                    a.status === "with_doctor" && "bg-status-with-doctor/[0.05]",
                    (a.status === "cancelled" || a.status === "rescheduled" || a.status === "no_show") && "opacity-60",
                  )}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="font-medium tabular-nums">{formatTime(a.scheduled_at, locale)}</div>
                    {showDate && (
                      <div className="text-xs text-muted-foreground">{formatDateLong(isoToClinicParts(a.scheduled_at).date, locale)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/patients/${a.patient_id}`} className="font-medium hover:text-primary hover:underline">
                      {a.patient?.full_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {a.patient?.patient_code}
                      {a.patient?.dob ? ` · ${ageFromDob(a.patient.dob)}y` : ""}
                      {a.patient?.phone ? (
                        <>
                          {" · "}
                          <span dir="ltr">{a.patient.phone}</span>
                        </>
                      ) : null}
                    </div>
                  </td>
                  {!hideDoctor && (
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: a.doctor?.color ?? "var(--primary)" }} />
                        {doctorName(a)}
                      </span>
                    </td>
                  )}
                  <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">{deptName(a)}</td>
                  <td className="px-4 py-2.5">{refs.optionLabel("appointment_type", a.visit_type)}</td>
                  <td className="px-4 py-2.5">
                    <AppointmentStatusBadge status={a.status} />
                    <VisitTrail appointment={a} />
                  </td>
                  <td className="px-4 py-2">
                    <AppointmentActions appointment={a} />
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Phone */}
      <ul className="space-y-2 md:hidden">
        <AnimatePresence initial={false}>
          {rows.map((a) => (
            <motion.li key={a.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div
                className={cn(
                  "rounded-xl border bg-card p-3 shadow-xs",
                  a.status === "checked_in" && "border-status-waiting/40",
                  (a.status === "cancelled" || a.status === "rescheduled") && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/patients/${a.patient_id}`} className="block truncate font-medium">
                      {a.patient?.full_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {a.patient?.patient_code} · {refs.optionLabel("appointment_type", a.visit_type)}
                    </p>
                  </div>
                  <AppointmentStatusBadge status={a.status} />
                </div>
                <VisitTrail appointment={a} />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold tabular-nums">{formatTime(a.scheduled_at, locale)}</span>
                    {showDate && <span className="text-muted-foreground"> · {formatDateLong(isoToClinicParts(a.scheduled_at).date, locale)}</span>}
                    {!hideDoctor && <span className="block text-xs text-muted-foreground">{doctorName(a)}</span>}
                  </div>
                  <AppointmentActions appointment={a} compact />
                </div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </>
  )
}

/** Appointment → arrival → visit → payment, as small history marks. */
function VisitTrail({ appointment: a }: { appointment: AppointmentWithRefs }) {
  const t = useTranslations("appointments.trail")
  const locale = useLocale()
  const v = a.visit
  if (!v) return null
  const done = v.status === "checked_out"
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <span>✓ {t("arrived", { time: formatTime(v.arrived_at, locale) })}</span>
      {(done || v.status === "awaiting_checkout") && <span>✓ {t("visitDone")}</span>}
      {v.paid === true && <span className="text-emerald-700 dark:text-emerald-300">✓ {t("paid")}</span>}
      {v.paid === false && v.balance != null && <span className="text-destructive">{t("due", { amount: v.balance.toFixed(3) })}</span>}
      {done && <span>✓ {t("checkedOut")}</span>}
      {v.status === "cancelled" && <span>{t("cancelled")}</span>}
    </p>
  )
}
