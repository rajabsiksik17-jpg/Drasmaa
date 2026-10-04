"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { ArrowUpRight, CheckCircle2, Loader2, Receipt, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/common/native-select"
import { useCan, useRefs } from "@/components/app-context"
import { InvoiceStatusBadge, Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { updateInvoice } from "@/lib/actions/accounting"
import { BillLinesEditor, type EditableLine } from "@/components/accounting/bill-lines-editor"
import { completeVisit } from "@/lib/actions/clinical"
import { P } from "@/lib/permissions"
import type { Invoice } from "@/types/db"

export type VisitBillInvoice = Pick<
  Invoice,
  | "id"
  | "invoice_number"
  | "status"
  | "currency"
  | "subtotal"
  | "discount_type"
  | "discount_value"
  | "discount_reason"
  | "discount_amount"
  | "total"
  | "insurance_amount"
  | "patient_amount"
  | "paid_patient"
  | "paid_insurance"
  | "balance_patient"
  | "balance_insurance"
  | "payment_type"
  | "insurance_company_id"
  | "insurance_claim_ref"
  | "notes"
  | "encounter_id"
  | "version"
> & {
  lines: {
    id?: string
    service_id?: string | null
    description_en: string
    description_ar: string
    quantity: number
    unit_price?: number
    default_price?: number | null
    discount_amount?: number
    notes?: string | null
    line_total: number
    package_line_id: string | null
    source?: string
  }[]
}

/**
 * The visit's bill inside the medical visit. In the post-payment workflow the
 * doctor completes it here (extra services, discount within the role limit);
 * reception then collects it. Payments are never visible here.
 */
export function VisitBill({
  invoice,
  editable,
  visitId,
  visitOpen = false,
}: {
  invoice: VisitBillInvoice
  editable: boolean
  visitId?: string
  visitOpen?: boolean
}) {
  const t = useTranslations("accounting")
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [discount, setDiscount] = useState({
    type: (invoice.discount_type ?? "percent") as "percent" | "fixed",
    value: String(invoice.discount_value ?? 0),
    reason: invoice.discount_reason ?? "",
  })
  const c = invoice.currency
  const paid = invoice.paid_patient + invoice.paid_insurance > 0
  const canCharge = editable && invoice.status !== "void" && (can(P.billingCharge) || can(P.accountingCreate))

  // "Finish visit": completes the medical visit; the final bill then goes to reception (realtime).
  const finish = () =>
    start(async () => {
      if (!visitId) return
      const res = await completeVisit(visitId)
      if (!res.ok) return showError(res.error)
      toast.success(t("visitFinished"))
      router.refresh()
    })

  const saveDiscount = () =>
    start(async () => {
      const value = Number(discount.value) || 0
      const res = await updateInvoice({
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentType: invoice.payment_type,
        insuranceCompanyId: invoice.insurance_company_id,
        insuranceAmount: Number(invoice.insurance_amount) || 0,
        insuranceClaimRef: invoice.insurance_claim_ref,
        discountType: value > 0 ? discount.type : null,
        discountValue: value,
        discountReason: discount.reason || null,
        notes: invoice.notes,
      })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Receipt className="size-4 text-primary" />
        <span className="text-sm font-semibold">{invoice.invoice_number}</span>
        <InvoiceStatusBadge status={invoice.status} />
        {can(P.accountingView) && (
          <Button size="sm" variant="outline" className="ms-auto" asChild>
            <Link href={`/accounting/invoices/${invoice.id}`}>
              {t("openCheckout")}
              <ArrowUpRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        )}
      </div>
      <BillLinesEditor
        invoiceId={invoice.id}
        currency={c}
        paymentType={invoice.payment_type}
        lines={invoice.lines.filter((l): l is typeof l & { id: string } => !!l.id) as EditableLine[]}
        editable={canCharge && !paid}
      />
      {paid && canCharge && <p className="mt-2 text-xs text-muted-foreground">{t("addAfterPaymentHint")}</p>}

      {canCharge && can(P.accountingDiscount) && !paid && (
        <div className="mt-3 grid gap-2 border-t pt-3">
          <p className="text-xs font-medium">{t("discount")}</p>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <NativeSelect value={discount.type} onChange={(e) => setDiscount({ ...discount, type: e.target.value as "percent" | "fixed" })} aria-label={t("discountType")}>
              <option value="percent">%</option>
              <option value="fixed">{c}</option>
            </NativeSelect>
            <Input type="number" inputMode="decimal" min={0} step="0.001" dir="ltr" value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} aria-label={t("discount")} />
          </div>
          <Input value={discount.reason} onChange={(e) => setDiscount({ ...discount, reason: e.target.value })} placeholder={t("discountReason")} />
          <Button variant="secondary" onClick={saveDiscount} disabled={pending || (Number(discount.value) > 0 && discount.reason.trim().length < 3)}>
            <Save />
            {t("saveDiscount")}
          </Button>
        </div>
      )}

      {visitId && visitOpen && can(P.visitsComplete) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">{refs.settings.collect_payment_before_consultation ? t("finishHintPrepay") : t("finishHintPostpay")}</p>
          <Button onClick={finish} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {t("finishVisit")}
          </Button>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("total")}</dt>
          <dd className="font-semibold">
            <Money value={invoice.total} currency={c} />
          </dd>
        </div>
        {invoice.discount_amount > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("discount")}</dt>
            <dd>
              <Money value={invoice.discount_amount} currency={c} />
            </dd>
          </div>
        )}
        {invoice.payment_type !== "cash" && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("insuranceShare")}</dt>
            <dd>
              <Money value={invoice.insurance_amount} currency={c} />
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">{t("patientShare")}</dt>
          <dd>
            <Money value={invoice.patient_amount} currency={c} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("paid")}</dt>
          <dd>
            <Money value={invoice.paid_patient + invoice.paid_insurance} currency={c} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("remaining")}</dt>
          <dd className={invoice.balance_patient + invoice.balance_insurance > 0 ? "font-semibold text-destructive" : ""}>
            <Money value={invoice.balance_patient + invoice.balance_insurance} currency={c} />
          </dd>
        </div>
      </dl>
    </div>
  )
}
