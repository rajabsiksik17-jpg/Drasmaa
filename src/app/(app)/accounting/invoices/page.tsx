import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { clinicDayRange } from "@/lib/dates"
import { resolveRange } from "@/lib/accounting/ranges"
import { InvoicesList, type InvoiceListRow } from "@/components/accounting/invoices-list"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounting.nav")
  return { title: t("invoices") }
}

export default async function InvoicesPage({ searchParams }: PageProps<"/accounting/invoices">) {
  await requirePagePermission(P.accountingView)
  const sp = await searchParams
  const status = typeof sp.status === "string" ? sp.status : "all"
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : ""
  // "unpaid" shows every open balance regardless of date.
  const range = resolveRange(status === "unpaid" ? { range: sp.range ?? "custom", from: sp.from ?? "2000-01-01", to: sp.to } : sp)
  const supabase = await createClient()
  let query = supabase
    .from("invoices")
    .select(
      "id, invoice_number, issued_at, status, payment_type, total, paid_patient, paid_insurance, balance_patient, balance_insurance, currency, patient:patients!inner(id, full_name, patient_code), doctor:doctors(display_name_en, display_name_ar)",
    )
    .gte("issued_at", clinicDayRange(range.from).start)
    .lt("issued_at", clinicDayRange(range.to).end)
    .order("issued_at", { ascending: false })
    .limit(300)
  if (status === "unpaid") query = query.in("status", ["open", "partially_paid"])
  else if (status !== "all") query = query.eq("status", status)
  if (q) {
    const safe = q.replace(/[%_,()]/g, " ")
    query = /^(INV|inv)-/.test(q) ? query.ilike("invoice_number", `%${safe}%`) : query.or(`full_name.ilike.%${safe}%,patient_code.ilike.%${safe}%`, { referencedTable: "patients" })
  }
  const { data } = await query
  return <InvoicesList rows={(data ?? []) as unknown as InvoiceListRow[]} range={range} status={status} q={q} />
}
