"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Ban, CheckCircle2, DoorOpen, Loader2, Plus, Printer, Receipt, RotateCcw, Save, ShieldCheck, Stethoscope, UserRound, Wallet, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/common/native-select"
import { SectionCard } from "@/components/common/page"
import { ReasonDialog } from "@/components/forms/correction-context"
import { useCan, useRefs } from "@/components/app-context"
import { BillLinesEditor } from "@/components/accounting/bill-lines-editor"
import { EncounterStatusBadge } from "@/components/encounters/encounter-status"
import { ExportMenu } from "@/components/documents/export-menu"
import { InvoiceStatusBadge, Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { recordPayments, refundPayment, updateInvoice, voidInvoice } from "@/lib/actions/accounting"
import { setEncounterStatus } from "@/lib/actions/encounters"
import { formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { InvoiceBundle } from "@/lib/data/invoice"
import type { PayMethod, PaymentType } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

type Insurer = { id: string; name_en: string; name_ar: string; default_coverage_percent: number | null; active: boolean }
type PayRow = { payer: "patient" | "insurance"; method: PayMethod; amount: string; reference: string }

const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Checkout: services (snapshot prices) → discount → cash / insurance / mixed
 * split → one or more payments → receipts. Totals are always computed by
 * the database; payments and refunds are permanent records.
 */
export function InvoiceCheckout({ bundle, insurers }: { bundle: InvoiceBundle; insurers: Insurer[] }) {
  const t = useTranslations("accounting")
  const locale = useLocale()
  const ar = locale === "ar"
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const inv = bundle.invoice
  const c = inv.currency
  const voided = inv.status === "void"
  const hasPayments = bundle.payments.length > 0
  const canCreate = can(P.accountingCreate) && !voided
  const canEditPaid = can(P.accountingEdit)
  const name = (x: { name_en: string; name_ar: string }) => (ar ? x.name_ar : x.name_en)

  // ---- invoice settings
  const [form, setForm] = useState({
    paymentType: inv.payment_type as PaymentType,
    insuranceCompanyId: inv.insurance_company_id ?? "",
    insuranceAmount: String(inv.insurance_amount ?? 0),
    insuranceClaimRef: inv.insurance_claim_ref ?? "",
    discountType: (inv.discount_type ?? "percent") as "percent" | "fixed",
    discountValue: String(inv.discount_value ?? 0),
    discountReason: inv.discount_reason ?? "",
    notes: inv.notes ?? "",
  })
  const [askReason, setAskReason] = useState<null | ((r: string) => void)>(null)
  const coverage = insurers.find((i) => i.id === form.insuranceCompanyId)?.default_coverage_percent ?? null

  const saveSettings = (reason?: string) =>
    start(async () => {
      const res = await updateInvoice({
        invoiceId: inv.id,
        expectedVersion: inv.version,
        paymentType: form.paymentType,
        insuranceCompanyId: form.paymentType === "cash" ? null : form.insuranceCompanyId || null,
        insuranceAmount: Number(form.insuranceAmount) || 0,
        insuranceClaimRef: form.insuranceClaimRef || null,
        discountType: Number(form.discountValue) > 0 ? form.discountType : null,
        discountValue: Number(form.discountValue) || 0,
        discountReason: form.discountReason || null,
        notes: form.notes || null,
        reason: reason ?? null,
      })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })
  const withReason = (fn: (reason?: string) => void) => (hasPayments ? setAskReason(() => (r: string) => fn(r)) : fn())

  // ---- payments
  const defaultRows = (): PayRow[] => {
    const rows: PayRow[] = []
    if (inv.balance_patient > 0) rows.push({ payer: "patient", method: refs.settings.payment_methods[0] ?? "cash", amount: String(round3(inv.balance_patient)), reference: "" })
    if (rows.length === 0 && inv.balance_insurance > 0) rows.push({ payer: "insurance", method: "insurance", amount: String(round3(inv.balance_insurance)), reference: inv.insurance_claim_ref ?? "" })
    return rows.length ? rows : [{ payer: "patient", method: "cash", amount: "", reference: "" }]
  }
  const [payRows, setPayRows] = useState<PayRow[]>(defaultRows)
  // One key per payment attempt: a double click or a retry after a lost
  // response records the payment once (database idempotency).
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const methods = refs.settings.payment_methods
  const payTotal = payRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const setRow = (i: number, patch: Partial<PayRow>) => setPayRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const pay = () =>
    start(async () => {
      const payments = payRows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => ({ payer: r.payer, method: r.payer === "insurance" ? ("insurance" as const) : r.method, amount: Number(r.amount), reference: r.reference || null }))
      if (payments.length === 0) return
      const res = await recordPayments({ invoiceId: inv.id, payments, requestKey })
      if (!res.ok) return showError(res.error, "recordPayment")
      setRequestKey(crypto.randomUUID())
      toast.success(t("paymentRecorded"), {
        action: { label: t("printReceipt"), onClick: () => window.open(`/print/receipt/${res.data.ids[0]}?autoprint=1`, "_blank", "noopener") },
      })
      router.refresh()
      setPayRows([{ payer: "patient", method: methods[0] ?? "cash", amount: "", reference: "" }])
    })

  // ---- refunds / void
  const [refund, setRefund] = useState<{ id: string; max: number; amount: string; reason: string } | null>(null)
  const [voidOpen, setVoidOpen] = useState(false)

  const refundedOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of bundle.payments) if (p.refund_of_id) m.set(p.refund_of_id, (m.get(p.refund_of_id) ?? 0) + Number(p.amount))
    return m
  }, [bundle.payments])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
        <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Receipt className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="font-mono">{inv.invoice_number}</span>
            <InvoiceStatusBadge status={inv.status} />
          </p>
          <p className="text-sm text-muted-foreground">
            <Link href={`/patients/${bundle.patient.id}?tab=billing`} className="inline-flex items-center gap-1 hover:text-primary">
              <UserRound className="size-3.5" />
              {bundle.patient.full_name} · {bundle.patient.patient_code}
            </Link>
            {bundle.doctor && ` · ${ar ? bundle.doctor.display_name_ar || bundle.doctor.display_name_en : bundle.doctor.display_name_en}`}
            {` · ${formatDateTime(inv.issued_at, locale)}`}
          </p>
          {voided && <p className="text-xs text-destructive">{t("voidedBecause", { reason: inv.void_reason ?? "" })}</p>}
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <ExportMenu target={{ type: "invoice", entityId: inv.id, patientId: bundle.patient.id }} label={t("invoice")} />
          {inv.insurance_company_id && <ExportMenu target={{ type: "insurance_claim", entityId: inv.id, patientId: bundle.patient.id }} label={t("claim")} />}
          {can(P.accountingEdit) && !voided && !hasPayments && (
            <Button variant="ghost" className="text-destructive" onClick={() => setVoidOpen(true)}>
              <Ban />
              {t("void")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <SectionCard title={t("services")} icon={Receipt} bodyClassName="p-3">
            <BillLinesEditor
              invoiceId={inv.id}
              currency={c}
              paymentType={inv.payment_type}
              lines={bundle.lines}
              editable={canCreate && (!hasPayments || canEditPaid)}
              withReason={hasPayments ? (fn) => setAskReason(() => (r: string) => fn(r)) : undefined}
            />
          </SectionCard>

          <SectionCard title={t("payments")} icon={Wallet} bodyClassName="p-0">
            {bundle.payments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("noPayments")}</p>
            ) : (
              <ul className="divide-y">
                {bundle.payments.map((p) => {
                  const refundable = p.kind === "payment" ? Number(p.amount) - (refundedOf.get(p.id) ?? 0) : 0
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className={cn("grid size-8 place-items-center rounded-full", p.kind === "refund" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300")}>
                        {p.kind === "refund" ? <RotateCcw className="size-4" /> : p.payer === "insurance" ? <ShieldCheck className="size-4" /> : <CheckCircle2 className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {p.kind === "refund" ? "−" : ""}
                          <Money value={p.amount} currency={c} /> · {t(`methods.${p.method}`)} · {t(`payers.${p.payer}`)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{p.receipt_number}</span> · {formatDateTime(p.received_at, locale)}
                          {p.received_by && ` · ${bundle.receivers[p.received_by] ?? ""}`}
                          {p.reference && ` · ${p.reference}`}
                          {p.reason && ` · ${p.reason}`}
                        </p>
                      </div>
                      <Button size="icon-sm" variant="ghost" asChild aria-label={t("printReceipt")}>
                        <a href={`/print/receipt/${p.id}?autoprint=1`} target="_blank" rel="noopener">
                          <Printer />
                        </a>
                      </Button>
                      <ExportMenu target={{ type: "receipt", entityId: p.id, patientId: bundle.patient.id }} size="icon-sm" />
                      {can(P.accountingRefund) && refundable > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => setRefund({ id: p.id, max: refundable, amount: String(refundable), reason: "" })}>
                          <RotateCcw />
                          {t("refund")}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-5">
          {bundle.encounter && <EncounterPanel encounter={bundle.encounter} balance={inv.balance_patient} currency={c} />}
          <SectionCard title={t("summary")} icon={Receipt}>
            <dl className="space-y-1.5 text-sm">
              <SumRow label={t("subtotal")} value={<Money value={inv.subtotal} currency={c} />} />
              {inv.discount_amount > 0 && <SumRow label={t("discount")} value={<span>− <Money value={inv.discount_amount} currency={c} /></span>} />}
              <SumRow label={t("total")} value={<Money value={inv.total} currency={c} className="font-semibold" />} strong />
              {inv.payment_type !== "cash" && (
                <>
                  <SumRow label={t("insuranceShare")} value={<Money value={inv.insurance_amount} currency={c} />} />
                  <SumRow label={t("patientShare")} value={<Money value={inv.patient_amount} currency={c} />} />
                </>
              )}
              <SumRow label={t("paid")} value={<Money value={inv.paid_patient + inv.paid_insurance} currency={c} />} />
              {inv.payment_type !== "cash" && <SumRow label={t("insurancePending")} value={<Money value={inv.balance_insurance} currency={c} />} />}
              <SumRow
                label={t("remainingPatient")}
                value={<Money value={inv.balance_patient} currency={c} className={inv.balance_patient > 0 ? "font-semibold text-destructive" : "font-semibold"} />}
                strong
              />
            </dl>
          </SectionCard>

          {canCreate && (inv.balance_patient > 0 || inv.balance_insurance > 0) && (
            <SectionCard title={t("takePayment")} icon={Wallet}>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {payRows.map((r, i) => (
                    <motion.div key={i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                      <NativeSelect value={r.payer} onChange={(e) => setRow(i, { payer: e.target.value as PayRow["payer"], method: e.target.value === "insurance" ? "insurance" : "cash" })} aria-label={t("payer")}>
                        <option value="patient">{t("payers.patient")}</option>
                        {inv.payment_type !== "cash" && <option value="insurance">{t("payers.insurance")}</option>}
                      </NativeSelect>
                      <NativeSelect value={r.method} disabled={r.payer === "insurance"} onChange={(e) => setRow(i, { method: e.target.value as PayMethod })} aria-label={t("method")}>
                        {(r.payer === "insurance" ? (["insurance"] as const) : methods).map((m) => (
                          <option key={m} value={m}>
                            {t(`methods.${m}`)}
                          </option>
                        ))}
                      </NativeSelect>
                      {payRows.length > 1 ? (
                        <Button size="icon-sm" variant="ghost" onClick={() => setPayRows((rows) => rows.filter((_, j) => j !== i))} aria-label={t("remove")}>
                          <X />
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Input type="number" min={0} step="0.001" dir="ltr" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} placeholder={t("amount")} aria-label={t("amount")} />
                      <Input value={r.reference} onChange={(e) => setRow(i, { reference: e.target.value })} placeholder={t("reference")} aria-label={t("reference")} className="col-span-2" />
                    </motion.div>
                  ))}
                </AnimatePresence>
                {payRows.length < 5 && (
                  <Button size="xs" variant="ghost" onClick={() => setPayRows((rows) => [...rows, { payer: "patient", method: methods.find((m) => m !== "cash") ?? methods[0], amount: "", reference: "" }])}>
                    <Plus />
                    {t("splitPayment")}
                  </Button>
                )}
                <Button className="w-full" onClick={pay} disabled={pending || payTotal <= 0}>
                  {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  {t("recordPayment")} · <Money value={payTotal} currency={c} />
                </Button>
              </div>
            </SectionCard>
          )}

          {canCreate && (
            <SectionCard title={t("paymentSettings")} icon={ShieldCheck}>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
                  {(["cash", "insurance", "mixed"] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setForm({ ...form, paymentType: pt })}
                      className={cn("rounded-md py-1 text-xs font-medium", form.paymentType === pt ? "bg-background shadow-sm" : "text-muted-foreground")}
                    >
                      {t(`paymentTypes.${pt}`)}
                    </button>
                  ))}
                </div>
                {form.paymentType !== "cash" && (
                  <>
                    <div className="grid gap-1">
                      <Label htmlFor="ck-ins">{t("insuranceCompany")}</Label>
                      <NativeSelect id="ck-ins" value={form.insuranceCompanyId} onChange={(e) => setForm({ ...form, insuranceCompanyId: e.target.value })}>
                        <option value="">—</option>
                        {insurers
                          .filter((i) => i.active || i.id === form.insuranceCompanyId)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {name(i)}
                              {i.default_coverage_percent != null ? ` (${i.default_coverage_percent}%)` : ""}
                            </option>
                          ))}
                      </NativeSelect>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="ck-ins-amt" className="flex items-center justify-between">
                        {t("insuranceShare")}
                        {coverage != null && (
                          <button type="button" className="text-xs text-primary" onClick={() => setForm({ ...form, insuranceAmount: String(round3((inv.total * coverage) / 100)) })}>
                            {t("applyCoverage", { percent: coverage })}
                          </button>
                        )}
                      </Label>
                      <Input id="ck-ins-amt" type="number" min={0} step="0.001" dir="ltr" value={form.insuranceAmount} onChange={(e) => setForm({ ...form, insuranceAmount: e.target.value })} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="ck-claim">{t("claimRef")}</Label>
                      <Input id="ck-claim" dir="ltr" value={form.insuranceClaimRef} onChange={(e) => setForm({ ...form, insuranceClaimRef: e.target.value })} />
                    </div>
                  </>
                )}
                {can(P.accountingDiscount) && (
                  <div className="grid gap-1">
                    <Label>{t("discount")}</Label>
                    <div className="flex gap-1.5">
                      <NativeSelect value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as "percent" | "fixed" })} className="w-24" aria-label={t("discountType")}>
                        <option value="percent">%</option>
                        <option value="fixed">{c}</option>
                      </NativeSelect>
                      <Input type="number" min={0} step="0.001" dir="ltr" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} aria-label={t("discount")} />
                    </div>
                    <Input
                      value={form.discountReason}
                      onChange={(e) => setForm({ ...form, discountReason: e.target.value })}
                      placeholder={t("discountReason")}
                      aria-invalid={Number(form.discountValue) > 0 && form.discountReason.trim().length < 3}
                    />
                    <p className="text-xs text-muted-foreground">
                      {bundle.discountLimit != null ? t("discountLimitHint", { percent: bundle.discountLimit }) : t("discountReasonHint")}
                    </p>
                  </div>
                )}
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("notes")} className="min-h-14" />
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={() => withReason((r) => saveSettings(r))}
                  disabled={pending || (Number(form.discountValue) > 0 && form.discountReason.trim().length < 3)}
                >
                  <Save />
                  {t("saveSettings")}
                </Button>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <ReasonDialog
        open={!!askReason}
        onOpenChange={(o) => !o && setAskReason(null)}
        onConfirm={(r) => {
          const fn = askReason
          setAskReason(null)
          fn?.(r)
        }}
      />

      <Dialog open={!!refund} onOpenChange={(o) => !o && setRefund(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("refund")}</DialogTitle>
            <DialogDescription>{t("refundHint")}</DialogDescription>
          </DialogHeader>
          {refund && (
            <div className="space-y-3">
              <div className="grid gap-1">
                <Label htmlFor="rf-amt">{t("amount")}</Label>
                <Input id="rf-amt" type="number" min={0} max={refund.max} step="0.001" dir="ltr" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="rf-reason">{t("reason")}</Label>
                <Textarea id="rf-reason" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefund(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!refund || pending || refund.reason.trim().length < 3 || !(Number(refund.amount) > 0) || Number(refund.amount) > refund.max}
              onClick={() =>
                start(async () => {
                  if (!refund) return
                  const res = await refundPayment({ paymentId: refund.id, amount: Number(refund.amount), reason: refund.reason })
                  if (!res.ok) return showError(res.error)
                  setRefund(null)
                  toast.success(t("refunded"))
                  router.refresh()
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {t("refund")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        onConfirm={(r) =>
          start(async () => {
            const res = await voidInvoice(inv.id, r)
            if (!res.ok) return showError(res.error)
            toast.success(t("voided"))
            router.refresh()
          })
        }
      />
    </div>
  )
}

/** Where the patient is in today's workflow, and the reception moves. */
function EncounterPanel({ encounter, balance, currency }: { encounter: NonNullable<InvoiceBundle["encounter"]>; balance: number; currency: string }) {
  const t = useTranslations("encounters")
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [ask, setAsk] = useState<null | "waiting_doctor" | "checked_out">(null)
  const unpaid = balance > 0.0005
  const move = (status: "waiting_doctor" | "checked_out", reason?: string) =>
    start(async () => {
      const res = await setEncounterStatus({ id: encounter.id, status, reason: reason ?? null })
      if (!res.ok) return showError(res.error)
      toast.success(t(status === "checked_out" ? "checkedOut" : "sentToDoctor"))
      router.refresh()
    })
  const request = (status: "waiting_doctor" | "checked_out") => (unpaid ? setAsk(status) : move(status))
  return (
    <SectionCard title={t("visit")} icon={DoorOpen}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <EncounterStatusBadge status={encounter.status} prepay={encounter.prepay} />
          <span className="text-xs text-muted-foreground">{t(encounter.prepay ? "prepayMode" : "postpayMode")}</span>
        </div>
        {encounter.reason && <p className="text-muted-foreground">{encounter.reason}</p>}
        {encounter.status === "waiting_payment" && can(P.accountingCreate) && (
          <Button className="w-full" variant={unpaid ? "outline" : "default"} onClick={() => request("waiting_doctor")} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Stethoscope />}
            {unpaid ? t("sendUnpaid") : t("sendToDoctor")}
          </Button>
        )}
        {encounter.status === "awaiting_checkout" && can(P.accountingCreate) && (
          <Button className="w-full" variant={unpaid ? "outline" : "default"} onClick={() => request("checked_out")} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <DoorOpen />}
            {unpaid ? t("checkoutWithBalance", { amount: balance.toFixed(3), currency }) : t("checkout")}
          </Button>
        )}
      </div>
      <ReasonDialog
        open={!!ask}
        onOpenChange={(o) => !o && setAsk(null)}
        onConfirm={(r) => {
          const status = ask
          setAsk(null)
          if (status) move(status, r)
        }}
      />
    </SectionCard>
  )
}

function SumRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong && "border-t pt-1.5")}>
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
