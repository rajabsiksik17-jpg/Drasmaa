"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowUpRight, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InvoiceStatusBadge, Money } from "@/components/accounting/money"
import type { Invoice } from "@/types/db"

export type InvoiceSummary = Pick<
  Invoice,
  "id" | "invoice_number" | "status" | "currency" | "subtotal" | "discount_amount" | "total" | "insurance_amount" | "patient_amount" | "paid_patient" | "paid_insurance" | "balance_patient" | "balance_insurance" | "payment_type"
> & { lines: { description_en: string; description_ar: string; quantity: number; line_total: number; package_line_id: string | null }[] }

/** End-of-visit financial summary (services, total, paid, remaining). */
export function BillingSummary({ invoice }: { invoice: InvoiceSummary }) {
  const t = useTranslations("accounting")
  const locale = useLocale()
  const c = invoice.currency
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Receipt className="size-4 text-primary" />
        <span className="text-sm font-semibold">{invoice.invoice_number}</span>
        <InvoiceStatusBadge status={invoice.status} />
        <Button size="sm" variant="outline" className="ms-auto" asChild>
          <Link href={`/accounting/invoices/${invoice.id}`}>
            {t("openCheckout")}
            <ArrowUpRight className="rtl:-scale-x-100" />
          </Link>
        </Button>
      </div>
      <ul className="divide-y text-sm">
        {invoice.lines
          .filter((l) => !l.package_line_id)
          .map((l, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5">
              <span>
                {locale === "ar" ? l.description_ar : l.description_en}
                {l.quantity > 1 && <span className="text-muted-foreground"> × {l.quantity}</span>}
              </span>
              <Money value={l.line_total} currency={c} />
            </li>
          ))}
      </ul>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("total")}</dt>
          <dd className="font-semibold">
            <Money value={invoice.total} currency={c} />
          </dd>
        </div>
        {invoice.payment_type !== "cash" && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("insuranceShare")}</dt>
            <dd>
              <Money value={invoice.insurance_amount} currency={c} />
            </dd>
          </div>
        )}
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
