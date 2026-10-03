import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { getInvoiceBundle } from "@/lib/data/invoice"
import { messageDate, messageTime } from "@/lib/messaging/variables"
import { KeyValues, ReportDocument } from "@/components/documents/report"
import { MoneyCell } from "@/components/documents/money-print"
import type { Payment } from "@/types/db"

/** Payment receipt (or refund voucher) for one payment. */
export default async function ReceiptPrint({ params }: PageProps<"/print/receipt/[id]">) {
  await requirePagePermission(P.accountingView)
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const supabase = await createClient()
  const { data } = await supabase.from("payments").select("*").eq("id", id).maybeSingle()
  if (!data) notFound()
  const pay = data as Payment
  const b = await getInvoiceBundle(pay.invoice_id)
  if (!b) notFound()
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()])
  const lang = locale === "ar" ? "ar" : "en"
  const inv = b.invoice
  const m = (v: number, bold = false) => <MoneyCell value={v} currency={inv.currency} locale={locale} bold={bold} />
  return (
    <ReportDocument
      type="receipt"
      title={pay.kind === "refund" ? t("refundVoucher") : undefined}
      patient={{ ...b.patient }}
      number={pay.receipt_number}
      documentDate={messageDate(pay.received_at).split("/").reverse().join("-")}
      footerKind="receipt"
    >
      <div className="rounded border-2 border-black/70 px-4 py-3 text-center">
        <p className="text-[12px]">{pay.kind === "refund" ? t("refunded") : t("received")}</p>
        <p className="text-[24px] font-bold">{m(pay.amount, true)}</p>
      </div>
      <KeyValues
        items={[
          [t("invoice"), inv.invoice_number],
          [t("date"), `${messageDate(pay.received_at)} ${messageTime(pay.received_at, lang)}`],
          [t("method"), t(`methods.${pay.method}`)],
          [t("payer"), t(`payers.${pay.payer}`)],
          [t("reference"), pay.reference],
          [t("reason"), pay.reason],
          [t("total"), m(inv.total)],
          [t("remaining"), m(inv.balance_patient + inv.balance_insurance)],
          [t("receivedBy"), pay.received_by ? (b.receivers[pay.received_by] ?? null) : null],
        ]}
      />
      <div className="mt-12 flex justify-end">
        <div className="min-w-48 border-t border-black/60 pt-1 text-center text-[11px]">{t("signature")}</div>
      </div>
    </ReportDocument>
  )
}
