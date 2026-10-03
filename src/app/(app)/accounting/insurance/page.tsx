import type { Metadata } from "next"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { ShieldCheck } from "lucide-react"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { formatDate } from "@/lib/dates"
import { SectionCard } from "@/components/common/page"
import { MoneyCell } from "@/components/documents/money-print"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounting.nav")
  return { title: t("insurance") }
}

/** Outstanding insurance claims grouped by company. */
export default async function InsurancePage() {
  await requirePagePermission(P.accountingView)
  const supabase = await createClient()
  const [t, locale, { data }] = await Promise.all([
    getTranslations("accounting"),
    getLocale(),
    supabase
      .from("invoices")
      .select("id, invoice_number, issued_at, insurance_amount, paid_insurance, balance_insurance, insurance_claim_ref, currency, insurance_company_id, company:insurance_companies(name_en, name_ar), patient:patients(full_name, patient_code)")
      .gt("balance_insurance", 0)
      .neq("status", "void")
      .order("issued_at")
      .limit(1000),
  ])
  type Row = {
    id: string
    invoice_number: string
    issued_at: string
    insurance_amount: number
    paid_insurance: number
    balance_insurance: number
    insurance_claim_ref: string | null
    currency: string
    insurance_company_id: string
    company: { name_en: string; name_ar: string } | null
    patient: { full_name: string; patient_code: string } | null
  }
  const rows = (data ?? []) as unknown as Row[]
  const groups = new Map<string, Row[]>()
  for (const r of rows) groups.set(r.insurance_company_id, [...(groups.get(r.insurance_company_id) ?? []), r])
  const ar = locale === "ar"
  return (
    <div className="space-y-5">
      {groups.size === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noOutstandingInsurance")}</p>}
      {[...groups.values()].map((list) => {
        const company = list[0].company
        const total = list.reduce((s, r) => s + Number(r.balance_insurance), 0)
        const c = list[0].currency
        return (
          <SectionCard
            key={list[0].insurance_company_id}
            title={
              <span className="flex items-center gap-2">
                {company ? (ar ? company.name_ar : company.name_en) : "—"}
                <span className="text-xs font-normal text-muted-foreground">
                  {t("outstandingTotal")}: <MoneyCell value={total} currency={c} locale={locale} bold />
                </span>
              </span>
            }
            icon={ShieldCheck}
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t("invoice")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("patient")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("claimRef")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("insuranceShare")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("insuranceOutstanding")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/accounting/invoices/${r.id}`} className="hover:text-primary">
                          {r.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{formatDate(r.issued_at.slice(0, 10))}</td>
                      <td className="px-3 py-2">{r.patient?.full_name}</td>
                      <td className="px-3 py-2">{r.insurance_claim_ref ?? "—"}</td>
                      <td className="px-3 py-2 text-end">
                        <MoneyCell value={r.insurance_amount} currency={c} locale={locale} />
                      </td>
                      <td className="px-3 py-2 text-end font-medium">
                        <MoneyCell value={r.balance_insurance} currency={c} locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )
      })}
    </div>
  )
}
