import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { getInvoiceBundle } from "@/lib/data/invoice"
import { messageDate } from "@/lib/messaging/variables"
import { KeyValues, ReportDocument, ReportSection, ReportTable, loadDoctor } from "@/components/documents/report"
import { MoneyCell } from "@/components/documents/money-print"

export default async function InvoicePrint({ params }: PageProps<"/print/invoice/[id]">) {
  await requirePagePermission(P.accountingView)
  const { id } = await params
  const b = await getInvoiceBundle(id)
  if (!b) notFound()
  const [t, locale, doctor] = await Promise.all([getTranslations("accounting"), getLocale(), loadDoctor(b.invoice.doctor_id)])
  const ar = locale === "ar"
  const inv = b.invoice
  const m = (v: number, bold = false) => <MoneyCell value={v} currency={inv.currency} locale={locale} bold={bold} />
  const lines = b.lines.filter((l) => !l.package_line_id)
  const components = (lineId: string) => b.lines.filter((l) => l.package_line_id === lineId)
  return (
    <ReportDocument
      type="invoice"
      patient={{ ...b.patient }}
      doctor={doctor}
      number={inv.invoice_number}
      documentDate={messageDate(inv.issued_at).split("/").reverse().join("-")}
      footerKind="invoice"
      subtitle={inv.status === "void" ? t("status.void") : undefined}
    >
      <ReportTable
        head={[t("service"), t("qty"), t("unitPrice"), t("amount")]}
        rows={lines.map((l) => [
          <span key="d">
            {ar ? l.description_ar : l.description_en}
            {components(l.id).length > 0 && (
              <span className="block text-[10.5px] text-black/60">
                {components(l.id)
                  .map((c) => `${ar ? c.description_ar : c.description_en} × ${c.quantity}`)
                  .join(" · ")}
              </span>
            )}
          </span>,
          String(l.quantity),
          m(l.unit_price),
          m(l.line_total),
        ])}
        empty={t("noLines")}
      />
      <div className="ms-auto w-full max-w-xs space-y-1 text-[12.5px]">
        <Row label={t("subtotal")} value={m(inv.subtotal)} />
        {inv.discount_amount > 0 && <Row label={inv.discount_type === "percent" ? t("discountPercent", { value: inv.discount_value }) : t("discount")} value={<>- {m(inv.discount_amount)}</>} />}
        <Row label={t("total")} value={m(inv.total, true)} strong />
        {inv.payment_type !== "cash" && (
          <>
            <Row label={t("insuranceShare")} value={m(inv.insurance_amount)} />
            <Row label={t("patientShare")} value={m(inv.patient_amount)} />
          </>
        )}
        <Row label={t("paid")} value={m(inv.paid_patient + inv.paid_insurance)} />
        <Row label={t("remaining")} value={m(inv.balance_patient + inv.balance_insurance, true)} strong />
      </div>
      {(b.insurance || inv.insurance_claim_ref) && (
        <ReportSection title={t("insurance")}>
          <KeyValues items={[[t("insuranceCompany"), b.insurance ? (ar ? b.insurance.name_ar : b.insurance.name_en) : null], [t("claimRef"), inv.insurance_claim_ref]]} />
        </ReportSection>
      )}
      {b.payments.length > 0 && (
        <ReportSection title={t("payments")}>
          <ReportTable
            head={[t("receipt"), t("date"), t("method"), t("amount")]}
            rows={b.payments.map((p) => [p.receipt_number, messageDate(p.received_at), t(`methods.${p.method}`), <span key="a">{p.kind === "refund" ? "- " : ""}{m(p.amount)}</span>])}
          />
        </ReportSection>
      )}
      {inv.notes && <p className="whitespace-pre-wrap text-[11.5px]">{inv.notes}</p>}
    </ReportDocument>
  )
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between border-t border-black/40 pt-1 font-bold" : "flex justify-between"}>
      <span>{label}</span>
      {value}
    </div>
  )
}
