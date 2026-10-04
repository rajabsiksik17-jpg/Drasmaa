"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowDown, CalendarClock, DoorOpen, Loader2, Receipt, Stethoscope } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AppointmentStatusBadge, VisitStatusBadge } from "@/components/common/status-badge"
import { EncounterStatusBadge } from "@/components/encounters/encounter-status"
import { InvoiceStatusBadge, Money } from "@/components/accounting/money"
import { useRefs } from "@/components/app-context"
import { getAppointmentDetail, type AppointmentDetail } from "@/lib/actions/encounters"
import { formatDateLong, formatTime, isoToClinicParts } from "@/lib/dates"
import type { AppointmentWithRefs, InvoiceStatus, VisitStatus } from "@/types/db"

/**
 * Appointment → check-in → clinic visit → doctor → bill, in one place: the
 * planned slot and what it became (no separate page).
 */
export function AppointmentDetailSheet({ appointment: a, open, onOpenChange }: { appointment: AppointmentWithRefs; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("appointments.detail")
  const tv = useTranslations("visits")
  const locale = useLocale()
  const refs = useRefs()
  const [detail, setDetail] = useState<AppointmentDetail | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getAppointmentDetail(a.id).then((res) => {
      if (cancelled) return
      if (res.ok) setDetail(res.data)
      else setError(true)
    })
    return () => {
      cancelled = true
    }
  }, [open, a.id])

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{value}</dd>
    </div>
  )
  const service = refs.services.find((s) => s.id === a.service_id)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" />
            {t("title")}
          </SheetTitle>
          <SheetDescription>{a.patient?.full_name}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6 text-sm">
          <section className="rounded-xl border p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("planned")}</p>
            <dl className="divide-y">
              {row(t("patient"), <Link href={`/patients/${a.patient_id}`} className="font-medium hover:text-primary">{a.patient?.full_name}</Link>)}
              {row(t("doctor"), refs.doctorName(a.doctor_id))}
              {row(t("scheduledFor"), `${formatDateLong(isoToClinicParts(a.scheduled_at).date, locale)} · ${formatTime(a.scheduled_at, locale)}`)}
              {row(t("reason"), service ? (locale === "ar" ? service.name_ar : service.name_en) : refs.optionLabel("appointment_type", a.visit_type))}
              {row(t("status"), <AppointmentStatusBadge status={a.status} />)}
              {row(t("payment"), a.no_charge ? t("noCharge") : a.payment_method === "insurance" ? refs.insuranceName(a.insurance_company_id) : t("cash"))}
              {a.outside_working_hours && row(t("outsideHours"), "⚠")}
              {a.notes && row(t("notes"), <span className="whitespace-pre-line">{a.notes}</span>)}
            </dl>
          </section>

          {!detail && !error && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
          {error && <p className="text-center text-destructive">{t("loadFailed")}</p>}
          {detail && (
            <>
              <ArrowDown className="mx-auto size-4 text-muted-foreground" />
              <section className="rounded-xl border p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <DoorOpen className="size-3.5" />
                  {t("relatedVisit")}
                </p>
                {detail.encounter ? (
                  <dl className="divide-y">
                    {row(t("arrived"), formatTime(detail.encounter.arrived_at, locale))}
                    {row(t("status"), <EncounterStatusBadge status={detail.encounter.status} prepay={detail.encounter.prepay} />)}
                  </dl>
                ) : (
                  <p className="text-muted-foreground">{t("notArrived")}</p>
                )}
                {detail.visits.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {detail.visits.map((v) => (
                      <li key={v.id}>
                        <Link href={`/patients/${a.patient_id}/visits/${v.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 hover:bg-muted">
                          <span className="flex items-center gap-2">
                            <Stethoscope className="size-4 text-primary" />
                            {tv(`type.${v.visit_type}`)} · {formatTime(v.started_at, locale)}
                          </span>
                          <VisitStatusBadge status={v.status as VisitStatus} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {detail.invoice && (
                <section className="rounded-xl border p-3">
                  <Link href={`/accounting/invoices/${detail.invoice.id}`} className="flex items-center justify-between gap-2 hover:text-primary">
                    <span className="flex items-center gap-2">
                      <Receipt className="size-4" />
                      <span className="font-mono">{detail.invoice.invoice_number}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Money value={detail.invoice.balance_patient} currency={refs.settings.currency} />
                      <InvoiceStatusBadge status={detail.invoice.status as InvoiceStatus} />
                    </span>
                  </Link>
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
