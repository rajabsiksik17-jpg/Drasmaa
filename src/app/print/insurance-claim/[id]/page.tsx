import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { getInvoiceBundle } from "@/lib/data/invoice"
import { messageDate } from "@/lib/messaging/variables"
import { KeyValues, ReportDocument, ReportSection, ReportTable, loadDoctor } from "@/components/documents/report"
import { MoneyCell } from "@/components/documents/money-print"

/** Insurance claim summary for one invoice. */
export default async function InsuranceClaimPrint({ params }: PageProps<"/print/insurance-claim/[id]">) {
  await requirePagePermission(P.accountingView)
  const { id } = await params
  const b = await getInvoiceBundle(id)
  if (!b || !b.insurance) notFound()
  const [t, locale, doctor] = await Promise.all([getTranslations("accounting"), getLocale(), loadDoctor(b.invoice.doctor_id)])
  const ar = locale === "ar"
  const inv = b.invoice
  const m = (v: number, bold = false) => <MoneyCell value={v} currency={inv.currency} locale={locale} bold={bold} />
  return (
    <ReportDocument type="insurance_claim" patient={{ ...b.patient }} doctor={doctor} number={inv.invoice_number} footerKind="invoice">
      <ReportSection title={t("insurance")}>
        <KeyValues
          items={[
            [t("insuranceCompany"), ar ? b.insurance.name_ar : b.insurance.name_en],
            [t("claimRef"), inv.insurance_claim_ref],
            [t("serviceDate"), b.appointment ? messageDate(b.appointment.scheduled_at) : messageDate(inv.issued_at)],
          ]}
        />
      </ReportSection>
      <ReportTable
        head={[t("service"), t("qty"), t("unitPrice"), t("amount")]}
        rows={b.lines.filter((l) => !l.package_line_id).map((l) => [ar ? l.description_ar : l.description_en, String(l.quantity), m(l.unit_price), m(l.line_total)])}
      />
      <KeyValues
        items={[
          [t("total"), m(inv.total, true)],
          [t("insuranceShare"), m(inv.insurance_amount, true)],
          [t("patientShare"), m(inv.patient_amount)],
          [t("insurancePaid"), m(inv.paid_insurance)],
          [t("insuranceOutstanding"), m(inv.balance_insurance, true)],
        ]}
      />
    </ReportDocument>
  )
}
