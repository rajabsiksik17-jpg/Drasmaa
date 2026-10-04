"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CalendarPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/common/native-select"
import { DateInput } from "@/components/common/date-input"
import { PatientPicker, type PickedPatient } from "@/components/patients/patient-picker"
import { useCan, useRefs, useSession } from "@/components/app-context"
import { P } from "@/lib/permissions"
import { useActionError } from "@/hooks/use-action-error"
import { createAppointment, getBusySlots, getPatientPaymentDefaults, rescheduleAppointment } from "@/lib/actions/appointments"
import { addDaysIso, clinicDateTimeToIso, clinicToday, isoToClinicParts } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

const schema = z
  .object({
    doctor_id: z.string().min(1, "required"),
    department_id: z.string().min(1, "required"),
    visit_type: z.string().min(1, "required"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required"),
    time: z.string().regex(/^\d{2}:\d{2}$/, "required"),
    duration_minutes: z.number().int().min(5).max(480),
    notes: z.string().max(1000).optional(),
    payment_method: z.enum(["cash", "insurance"]),
    insurance_company_id: z.string().optional(),
    service_id: z.string().optional(),
    no_charge: z.boolean().optional(),
    outside_working_hours: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.payment_method === "insurance" && !v.insurance_company_id) {
      ctx.addIssue({ code: "custom", path: ["insurance_company_id"], message: "required" })
    }
  })

type FormValues = z.infer<typeof schema>

const toMin = (s: string) => {
  const [h, m] = s.slice(0, 5).split(":").map(Number)
  return h * 60 + m
}
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`

/** Working periods of a doctor on a date: own schedule, else clinic hours / days. */
function workingPeriods(refs: ReturnType<typeof useRefs>, doctorId: string, date: string): [number, number][] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const own = refs.doctorHours.filter((h) => h.doctor_id === doctorId)
  if (own.length) return own.filter((h) => h.weekday === weekday).map((h) => [toMin(h.start_time), toMin(h.end_time)])
  if (!refs.settings.working_days.includes(weekday)) return []
  return [[toMin(refs.settings.working_hours_start), toMin(refs.settings.working_hours_end)]]
}

function buildSlots(periods: [number, number][], step: number, duration: number) {
  const out: string[] = []
  for (const [from, to] of periods) for (let m = from; m + duration <= to; m += step) out.push(toTime(m))
  return out
}

const withinPeriods = (periods: [number, number][], time: string, duration: number) =>
  /^\d{2}:\d{2}$/.test(time) && periods.some(([from, to]) => toMin(time) >= from && toMin(time) + duration <= to)

export interface AppointmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient?: PickedPatient | null
  /** When set, the dialog reschedules this appointment instead of creating one. */
  reschedule?: { id: string; doctor_id: string; department_id: string; visit_type: string; scheduled_at: string; duration_minutes: number; notes: string | null }
  defaults?: Partial<Pick<FormValues, "doctor_id" | "department_id" | "visit_type" | "date">>
  sourceVisitId?: string | null
  onDone?: (id: string) => void
}

export function AppointmentDialog({ open, onOpenChange, patient: fixedPatient, reschedule, defaults, sourceVisitId, onDone }: AppointmentDialogProps) {
  const t = useTranslations("appointments")
  const tc = useTranslations("common")
  const refs = useRefs()
  const session = useSession()
  const router = useRouter()
  const { message } = useActionError()
  const [patient, setPatient] = useState<PickedPatient | null>(fixedPatient ?? null)
  const [patientError, setPatientError] = useState(false)
  const [pending, startTransition] = useSafeTransition()

  const ownDoctor = refs.doctors.find((d) => d.id === session.doctorId)
  const initial: FormValues = useMemo(() => {
    if (reschedule) {
      const parts = isoToClinicParts(reschedule.scheduled_at)
      return {
        doctor_id: reschedule.doctor_id,
        department_id: reschedule.department_id,
        visit_type: reschedule.visit_type,
        date: parts.date,
        time: parts.time,
        duration_minutes: reschedule.duration_minutes,
        notes: reschedule.notes ?? "",
        payment_method: "cash",
        insurance_company_id: "",
      }
    }
    return {
      doctor_id: defaults?.doctor_id ?? ownDoctor?.id ?? "",
      department_id: defaults?.department_id ?? ownDoctor?.department_id ?? "",
      visit_type: defaults?.visit_type ?? "",
      date: defaults?.date ?? clinicToday(),
      time: "",
      duration_minutes: refs.settings.appointment_slot_minutes,
      notes: "",
      payment_method: "cash",
      insurance_company_id: "",
    }
  }, [reschedule, defaults, ownDoctor, refs.settings.appointment_slot_minutes])

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initial })
  const [doctorId, date, paymentMethod, duration, time, outside] = useWatch({
    control: form.control,
    name: ["doctor_id", "date", "payment_method", "duration_minutes", "time", "outside_working_hours"],
  })
  const can = useCan()
  const enforce = refs.settings.enforce_working_hours
  const mayGoOutside = can(P.appointmentsOutsideHours)

  // Callers mount this dialog only while it is open, so every opening starts
  // from fresh defaults (no reset effect needed).

  // Payment defaults come from the patient file (single source of truth).
  useEffect(() => {
    if (!open || !patient || reschedule) return
    let cancelled = false
    void getPatientPaymentDefaults(patient.id).then((res) => {
      if (cancelled || !res.ok) return
      form.setValue("payment_method", res.data.payment_method)
      form.setValue("insurance_company_id", res.data.insurance_company_id ?? "")
      // Pre-select the patient's assigned doctor when no doctor was chosen yet.
      if (!form.getValues("doctor_id") && res.data.assigned_doctor_id) form.setValue("doctor_id", res.data.assigned_doctor_id)
    })
    return () => {
      cancelled = true
    }
  }, [open, patient, reschedule, form])

  // Doctor → department default.
  useEffect(() => {
    const d = refs.doctors.find((x) => x.id === doctorId)
    if (d?.department_id && !reschedule) form.setValue("department_id", d.department_id)
  }, [doctorId, refs.doctors, reschedule, form])

  const busy = useQuery({
    queryKey: ["busy", doctorId, date],
    queryFn: async () => {
      const res = await getBusySlots(doctorId, date)
      return res.ok ? res.data : []
    },
    enabled: open && !!doctorId && /^\d{4}-\d{2}-\d{2}$/.test(date),
  })

  const periods = useMemo(() => workingPeriods(refs, doctorId, date), [refs, doctorId, date])
  const slotStep = refs.settings.appointment_slot_minutes
  const slots = useMemo(() => buildSlots(periods, slotStep, duration || slotStep), [periods, slotStep, duration])
  const timeOutside = !!time && !withinPeriods(periods, time, duration || slotStep)

  const isTaken = (time: string) => {
    if (!busy.data) return false
    const start = new Date(clinicDateTimeToIso(date, time)).getTime()
    const end = start + (duration || refs.settings.appointment_slot_minutes) * 60_000
    return busy.data.some((b) => {
      if (reschedule && new Date(b.start).getTime() === new Date(reschedule.scheduled_at).getTime()) return false
      return start < new Date(b.end).getTime() && new Date(b.start).getTime() < end
    })
  }
  const [now] = useState(() => Date.now())
  const isPast = (time: string) => new Date(clinicDateTimeToIso(date, time)).getTime() < now - 5 * 60_000

  const onSubmit = form.handleSubmit((values) => {
    if (!reschedule && !patient) {
      setPatientError(true)
      return
    }
    // Outside the working hours only as an explicit, permitted decision.
    if (enforce && timeOutside && !values.outside_working_hours) {
      form.setError("time", { message: "outsideHours" })
      toast.error(t("outsideHoursBlocked"))
      return
    }
    startTransition(async () => {
      const res = reschedule
        ? await rescheduleAppointment({
            id: reschedule.id,
            date: values.date,
            time: values.time,
            doctor_id: values.doctor_id,
            duration_minutes: values.duration_minutes,
            notes: values.notes || null,
            outside_working_hours: enforce && timeOutside && !!values.outside_working_hours,
          })
        : await createAppointment({
            patient_id: patient!.id,
            doctor_id: values.doctor_id,
            department_id: values.department_id,
            visit_type: values.visit_type,
            date: values.date,
            time: values.time,
            duration_minutes: values.duration_minutes,
            notes: values.notes || null,
            payment_method: values.payment_method,
            insurance_company_id: values.payment_method === "insurance" ? values.insurance_company_id || null : null,
            source_visit_id: sourceVisitId ?? null,
            service_id: values.service_id || null,
            no_charge: !!values.no_charge,
            outside_working_hours: enforce && timeOutside && !!values.outside_working_hours,
          })
      if (!res.ok) {
        toast.error(message(res.error, reschedule ? "rescheduleAppointment" : "createAppointment"))
        if (res.error.code === "doubleBooking") void busy.refetch()
        return
      }
      toast.success(reschedule ? t("rescheduled") : t("created"))
      onOpenChange(false)
      onDone?.(res.data.id)
      router.refresh()
    })
  })

  const err = (name: keyof FormValues) => form.formState.errors[name]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-5 text-primary" />
            {reschedule ? t("rescheduleTitle") : sourceVisitId ? t("followUpTitle") : t("newTitle")}
          </DialogTitle>
          <DialogDescription>{reschedule ? t("rescheduleHint") : t("newHint")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {!reschedule && (
            <div className="grid gap-1.5">
              <Label>{t("patient")}</Label>
              {fixedPatient ? (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium">
                  {fixedPatient.full_name} · <span className="text-muted-foreground">{fixedPatient.patient_code}</span>
                </div>
              ) : (
                <PatientPicker value={patient} onChange={(p) => { setPatient(p); setPatientError(false) }} invalid={patientError} />
              )}
              {patientError && <p className="text-xs text-destructive">{tc("required")}</p>}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ap-doctor">{t("doctor")}</Label>
              <NativeSelect id="ap-doctor" {...form.register("doctor_id")} invalid={!!err("doctor_id")}>
                <option value="">{tc("select")}</option>
                {refs.activeDoctors(form.getValues("doctor_id")).map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-dept">{t("department")}</Label>
              <NativeSelect id="ap-dept" {...form.register("department_id")} invalid={!!err("department_id")} disabled={!!reschedule}>
                <option value="">{tc("select")}</option>
                {refs.activeDepartments(form.getValues("department_id")).map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-type">{t("visitType")}</Label>
              <NativeSelect id="ap-type" {...form.register("visit_type")} invalid={!!err("visit_type")} disabled={!!reschedule}>
                <option value="">{tc("select")}</option>
                {refs.activeOptions("appointment_type", form.getValues("visit_type")).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ap-date">{t("date")}</Label>
                <Controller
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <DateInput
                      id="ap-date"
                      value={field.value || null}
                      min={reschedule ? undefined : clinicToday()}
                      invalid={!!err("date")}
                      onChange={(v) => field.onChange(v ?? "")}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ap-duration">{t("duration")}</Label>
                <NativeSelect id="ap-duration" {...form.register("duration_minutes", { valueAsNumber: true })}>
                  {[10, 15, 20, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>{t("minutes", { count: m })}</option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>{t("time")}</Label>
              <div className="flex gap-1">
                <Button type="button" size="xs" variant="ghost" onClick={() => form.setValue("date", clinicToday())}>{t("today")}</Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => form.setValue("date", addDaysIso(clinicToday(), 1))}>{t("tomorrow")}</Button>
              </div>
            </div>
            <Controller
              control={form.control}
              name="time"
              render={({ field }) => (
                <div className={cn("grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border p-2 sm:grid-cols-6", err("time") && "border-destructive")}>
                  {!doctorId && <p className="col-span-full p-2 text-center text-xs text-muted-foreground">{t("pickDoctorFirst")}</p>}
                  {doctorId && busy.isLoading && <Loader2 className="col-span-full mx-auto my-3 size-4 animate-spin text-muted-foreground" />}
                  {doctorId && !busy.isLoading && slots.length === 0 && (
                    <p className="col-span-full p-2 text-center text-xs text-muted-foreground">{t("noWorkingHours")}</p>
                  )}
                  {doctorId && !busy.isLoading && slots.map((s) => {
                    const taken = isTaken(s)
                    const past = isPast(s)
                    const selected = field.value === s
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={taken || past}
                        onClick={() => field.onChange(s)}
                        className={cn(
                          "h-8 rounded-md border text-xs font-medium tabular-nums transition",
                          selected ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50 hover:bg-primary/5",
                          (taken || past) && "cursor-not-allowed border-dashed bg-muted text-muted-foreground/60 line-through hover:bg-muted",
                        )}
                        aria-pressed={selected}
                        title={taken ? t("slotTaken") : undefined}
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
              )}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{t("customTime")}</span>
              <Input type="time" className="h-8 w-28" value={time} onChange={(e) => form.setValue("time", e.target.value, { shouldValidate: true })} />
              {enforce && mayGoOutside && (
                <label className="flex items-center gap-1.5 text-foreground">
                  <input type="checkbox" {...form.register("outside_working_hours")} className="size-4 accent-amber-600" />
                  {t("allowOutside")}
                </label>
              )}
            </div>
            {enforce && timeOutside && (
              <p
                role="alert"
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                  outside ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-destructive/40 bg-destructive/5 text-destructive",
                )}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {outside ? t("outsideWarning") : mayGoOutside ? t("outsideNeedsTick") : t("outsideNotAllowed")}
              </p>
            )}
          </div>

          {!reschedule && <ServiceField form={form} />}

          {!reschedule && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ap-pay">{t("payment")}</Label>
                <NativeSelect id="ap-pay" {...form.register("payment_method")}>
                  <option value="cash">{t("cash")}</option>
                  <option value="insurance">{t("insurance")}</option>
                </NativeSelect>
              </div>
              {paymentMethod === "insurance" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="ap-ins">{t("insuranceCompany")}</Label>
                  <NativeSelect id="ap-ins" {...form.register("insurance_company_id")} invalid={!!err("insurance_company_id")}>
                    <option value="">{tc("select")}</option>
                    {refs.activeInsurance(form.getValues("insurance_company_id")).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="ap-notes">{t("notes")}</Label>
            <Textarea id="ap-notes" rows={2} {...form.register("notes")} />
          </div>

          <DialogFooter className="max-sm:sticky max-sm:bottom-0 max-sm:bg-background max-sm:py-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {reschedule ? t("confirmReschedule") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Service / reason of the appointment (price shown to users who may see prices). */
function ServiceField({ form }: { form: ReturnType<typeof useForm<FormValues>> }) {
  const t = useTranslations("appointments")
  const refs = useRefs()
  const can = useCan()
  const locale = useLocale()
  const [visitType, serviceId, noCharge, payment] = useWatch({ control: form.control, name: ["visit_type", "service_id", "no_charge", "payment_method"] })
  const services = refs.services.filter((s) => s.active && s.category !== "package")
  const auto = services.find((s) => s.appointment_type === visitType)
  const chosen = services.find((s) => s.id === (serviceId || auto?.id))
  const price = chosen ? (payment === "insurance" && chosen.insurance_eligible ? (chosen.price_insurance ?? chosen.price_cash) : chosen.price_cash) : null
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="ap-service">{t("service")}</Label>
        <NativeSelect id="ap-service" {...form.register("service_id")}>
          <option value="">{auto ? t("serviceAuto", { name: locale === "ar" ? auto.name_ar : auto.name_en }) : t("noService")}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {locale === "ar" ? s.name_ar : s.name_en}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex items-center gap-3 pb-2 text-sm">
        {can(P.pricingView) && chosen && !noCharge && chosen.billable && price != null && (
          <span className="font-medium tabular-nums" dir="ltr">
            {Number(price).toFixed(3)} {refs.settings.currency}
          </span>
        )}
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" {...form.register("no_charge")} className="size-4 accent-primary" />
          {t("noCharge")}
        </label>
      </div>
    </div>
  )
}
