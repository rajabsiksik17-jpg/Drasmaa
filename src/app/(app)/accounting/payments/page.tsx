import type { Metadata } from "next"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { clinicDayRange, formatDateTime } from "@/lib/dates"
import { resolveRange } from "@/lib/accounting/ranges"
import { RangeFilter } from "@/components/accounting/range-filter"
import { MoneyCell } from "@/components/documents/money-print"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounting.nav")
  return { title: t("payments") }
}

/** Payments & refunds journal (permanent records). */
export default async function PaymentsPage({ searchParams }: PageProps<"/accounting/payments">) {
  await requirePagePermission(P.accountingView)
  const range = resolveRange(await searchParams)
  const supabase = await createClient()
  const [t, locale, { data }, { data: profiles }] = await Promise.all([
    getTranslations("accounting"),
    getLocale(),
    supabase
      .from("payments")
      .select("id, receipt_number, kind, payer, method, amount, reference, reason, received_at, received_by, invoice:invoices(id, invoice_number, currency), patient:patients(full_name)")
      .gte("received_at", clinicDayRange(range.from).start)
      .lt("received_at", clinicDayRange(range.to).end)
      .order("received_at", { ascending: false })
      .limit(1000),
    supabase.from("profiles").select("id, full_name"),
  ])
  type Row = {
    id: string
    receipt_number: string
    kind: "payment" | "refund"
    payer: string
    method: string
    amount: number
    reference: string | null
    reason: string | null
    received_at: string
    received_by: string | null
    invoice: { id: string; invoice_number: string; currency: string } | null
    patient: { full_name: string } | null
  }
  const rows = (data ?? []) as unknown as Row[]
  const people = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]))
  const net = rows.reduce((s, r) => s + (r.kind === "refund" ? -1 : 1) * Number(r.amount), 0)
  const c = rows[0]?.invoice?.currency ?? "JOD"
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RangeFilter range={range} />
        <a href={`/api/accounting/export?kind=payments&from=${range.from}&to=${range.to}`} className="ms-auto text-sm text-primary hover:underline">
          CSV
        </a>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("receipt")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("patient")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("invoice")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("method")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("receivedBy")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/40">
                <td className="px-3 py-2 font-mono text-xs">
                  <a href={`/print/receipt/${r.id}`} target="_blank" rel="noopener" className="hover:text-primary">
                    {r.receipt_number}
                  </a>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.received_at, locale)}</td>
                <td className="px-3 py-2">{r.patient?.full_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.invoice && <Link href={`/accounting/invoices/${r.invoice.id}`}>{r.invoice.invoice_number}</Link>}</td>
                <td className="px-3 py-2">
                  {t(`methods.${r.method}`)} · {t(`payers.${r.payer}`)}
                  {r.kind === "refund" && <span className="ms-1.5 text-xs text-destructive">({t("refund")}: {r.reason})</span>}
                </td>
                <td className="px-3 py-2">{r.received_by ? people.get(r.received_by) : "—"}</td>
                <td className={r.kind === "refund" ? "px-3 py-2 text-end text-destructive" : "px-3 py-2 text-end"}>
                  {r.kind === "refund" ? "−" : ""}
                  <MoneyCell value={r.amount} currency={r.invoice?.currency ?? c} locale={locale} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  {t("noPayments")}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t bg-muted/30 font-medium">
              <tr>
                <td colSpan={6} className="px-3 py-2">
                  {t("netCollected")}
                </td>
                <td className="px-3 py-2 text-end">
                  <MoneyCell value={net} currency={c} locale={locale} bold />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
