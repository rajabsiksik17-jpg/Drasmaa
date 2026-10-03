import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { getInvoiceBundle } from "@/lib/data/invoice"
import { InvoiceCheckout } from "@/components/accounting/invoice-checkout"
import type { Service } from "@/types/db"

export async function generateMetadata({ params }: PageProps<"/accounting/invoices/[id]">): Promise<Metadata> {
  const t = await getTranslations("accounting")
  const { id } = await params
  return { title: `${t("invoice")} ${id.slice(0, 8)}` }
}

export default async function InvoicePage({ params }: PageProps<"/accounting/invoices/[id]">) {
  await requirePagePermission(P.accountingView)
  const { id } = await params
  const bundle = await getInvoiceBundle(id)
  if (!bundle) notFound()
  const supabase = await createClient()
  const [{ data: services }, { data: insurers }, { data: specialPrices }] = await Promise.all([
    supabase.from("services").select("*").eq("active", true).order("sort_order"),
    supabase.from("insurance_companies").select("id, name_en, name_ar, default_coverage_percent, active").order("name_en"),
    supabase.from("service_insurance_prices").select("service_id, insurance_company_id, price"),
  ])
  return (
    <InvoiceCheckout
      bundle={bundle}
      services={(services ?? []) as Service[]}
      insurers={(insurers ?? []) as { id: string; name_en: string; name_ar: string; default_coverage_percent: number | null; active: boolean }[]}
      specialPrices={(specialPrices ?? []) as { service_id: string; insurance_company_id: string; price: number }[]}
    />
  )
}
