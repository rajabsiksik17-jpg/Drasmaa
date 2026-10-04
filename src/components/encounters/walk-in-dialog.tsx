"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { DoorOpen, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/common/native-select"
import { PatientPicker, type PickedPatient } from "@/components/patients/patient-picker"
import { useCan, useRefs, useSession } from "@/components/app-context"
import { Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { createEncounter, getWalkInDefaults, type WalkInDefaults } from "@/lib/actions/encounters"
import { P } from "@/lib/permissions"

/**
 * "Create visit now": the patient is here (walk-in or without booking). No
 * fake appointment is created — the clinic visit is its own record, stamped
 * with the server time, with its bill (registration on the first visit +
 * the chosen service) and its place in today's queue.
 */
export function WalkInDialog({
  open,
  onOpenChange,
  patient: fixedPatient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient?: PickedPatient | null
}) {
  const t = useTranslations("encounters")
  const tc = useTranslations("common")
  const ta = useTranslations("appointments")
  const locale = useLocale()
  const refs = useRefs()
  const session = useSession()
  const can = useCan()
  const router = useRouter()
  const { message } = useActionError()
  const [pending, start] = useSafeTransition()
  const [patient, setPatient] = useState<PickedPatient | null>(fixedPatient ?? null)
  const [defaults, setDefaults] = useState<WalkInDefaults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [v, setV] = useState({
    doctorId: session.doctorId ?? "",
    serviceId: "",
    reason: "",
    paymentMethod: "cash" as "cash" | "insurance",
    insuranceCompanyId: "",
    noCharge: false,
  })

  // Payment defaults + first-visit fee come from the patient file.
  useEffect(() => {
    if (!open || !patient) return
    let cancelled = false
    void getWalkInDefaults(patient.id).then((res) => {
      if (cancelled) return
      if (!res.ok) return setError(message(res.error))
      setDefaults(res.data)
      setV((x) => ({
        ...x,
        paymentMethod: res.data.payment_method,
        insuranceCompanyId: res.data.insurance_company_id ?? "",
        doctorId: x.doctorId || res.data.assigned_doctor_id || "",
      }))
    })
    return () => {
      cancelled = true
    }
  }, [open, patient, message])

  const services = refs.services.filter((s) => s.active && s.category !== "package" && s.auto_trigger !== "registration")
  const registration = refs.services.find((s) => s.auto_trigger === "registration" && s.active && s.billable)
  const chosen = services.find((s) => s.id === v.serviceId)
  const showPrices = can(P.pricingView) || can(P.accountingView)
  const priceOf = (s: (typeof services)[number] | undefined) =>
    !s || !s.billable ? 0 : Number(v.paymentMethod === "insurance" && s.insurance_eligible ? (s.price_insurance ?? s.price_cash) : s.price_cash)
  const lines = useMemo(() => {
    if (v.noCharge) return []
    const out: { label: string; amount: number }[] = []
    if (defaults?.first_visit && registration) out.push({ label: locale === "ar" ? registration.name_ar : registration.name_en, amount: priceOf(registration) })
    if (chosen) out.push({ label: locale === "ar" ? chosen.name_ar : chosen.name_en, amount: priceOf(chosen) })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, registration, chosen, v.noCharge, v.paymentMethod, locale])
  const total = lines.reduce((s, l) => s + l.amount, 0)
  const needsDoctor = !!chosen?.requires_doctor && !v.doctorId

  const submit = () =>
    start(async () => {
      if (!patient) return
      setError(null)
      const res = await createEncounter({
        patientId: patient.id,
        doctorId: v.doctorId || null,
        serviceId: v.serviceId || null,
        reason: v.reason || null,
        paymentMethod: v.paymentMethod,
        insuranceCompanyId: v.paymentMethod === "insurance" ? v.insuranceCompanyId || null : null,
        noCharge: v.noCharge,
      })
      if (!res.ok) return setError(message(res.error, "createVisit"))
      onOpenChange(false)
      const prepay = refs.settings.collect_payment_before_consultation
      if (prepay && res.data.invoiceId && total > 0 && can(P.accountingCreate)) {
        toast.success(t("createdCollect"))
        router.push(`/accounting/invoices/${res.data.invoiceId}`)
      } else {
        toast.success(t("created"))
        router.refresh()
      }
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:grid-rows-[auto_1fr_auto] max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DoorOpen className="size-5 text-primary" />
            {t("createNow")}
          </DialogTitle>
          <DialogDescription>{refs.settings.collect_payment_before_consultation ? t("createNowHintPrepay") : t("createNowHintPostpay")}</DialogDescription>
        </DialogHeader>

        <div className="grid content-start gap-4">
          <div className="grid gap-1.5">
            <Label>{ta("patient")}</Label>
            {fixedPatient ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium">
                {fixedPatient.full_name} · <span className="text-muted-foreground">{fixedPatient.patient_code}</span>
              </div>
            ) : (
              <PatientPicker value={patient} onChange={(p) => { setPatient(p); setDefaults(null) }} />
            )}
            {defaults?.open_encounter_id && <p className="text-xs text-amber-700 dark:text-amber-300">{t("alreadyHere")}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="wi-doctor">{ta("doctor")}</Label>
              <NativeSelect id="wi-doctor" value={v.doctorId} onChange={(e) => setV({ ...v, doctorId: e.target.value })} invalid={needsDoctor}>
                <option value="">{t("anyDoctor")}</option>
                {refs.activeDoctors(v.doctorId).map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wi-service">{ta("service")}</Label>
              <NativeSelect id="wi-service" value={v.serviceId} onChange={(e) => setV({ ...v, serviceId: e.target.value })}>
                <option value="">{ta("noService")}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {locale === "ar" ? s.name_ar : s.name_en}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wi-pay">{ta("payment")}</Label>
              <NativeSelect id="wi-pay" value={v.paymentMethod} onChange={(e) => setV({ ...v, paymentMethod: e.target.value as "cash" | "insurance" })}>
                <option value="cash">{ta("cash")}</option>
                <option value="insurance">{ta("insurance")}</option>
              </NativeSelect>
            </div>
            {v.paymentMethod === "insurance" && (
              <div className="grid gap-1.5">
                <Label htmlFor="wi-ins">{ta("insuranceCompany")}</Label>
                <NativeSelect id="wi-ins" value={v.insuranceCompanyId} onChange={(e) => setV({ ...v, insuranceCompanyId: e.target.value })} invalid={!v.insuranceCompanyId}>
                  <option value="">{tc("select")}</option>
                  {refs.activeInsurance(v.insuranceCompanyId).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wi-reason">{t("reason")}</Label>
            <Textarea id="wi-reason" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder={t("reasonPlaceholder")} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.noCharge} onChange={(e) => setV({ ...v, noCharge: e.target.checked })} className="size-4 accent-primary" />
            {ta("noCharge")}
          </label>

          {showPrices && patient && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t("billPreview")}</p>
              {lines.length === 0 ? (
                <p className="text-muted-foreground">{t("nothingToPay")}</p>
              ) : (
                <ul className="space-y-1">
                  {lines.map((l) => (
                    <li key={l.label} className="flex justify-between gap-3">
                      <span>{l.label}</span>
                      <Money value={l.amount} currency={refs.settings.currency} />
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 border-t pt-1 font-semibold">
                    <span>{t("total")}</span>
                    <Money value={total} currency={refs.settings.currency} />
                  </li>
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{v.paymentMethod === "insurance" ? t("insuranceNote") : t("previewNote")}</p>
            </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter className="max-sm:sticky max-sm:bottom-0 max-sm:bg-background max-sm:py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !patient || needsDoctor || (v.paymentMethod === "insurance" && !v.insuranceCompanyId)}>
            {pending ? <Loader2 className="animate-spin" /> : <DoorOpen />}
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
