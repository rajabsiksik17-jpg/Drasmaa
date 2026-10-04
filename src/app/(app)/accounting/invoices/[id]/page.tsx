import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { getInvoiceBundle } from "@/lib/data/invoice"
import { InvoiceCheckout } from "@/components/accounting/invoice-checkout"

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
  const { data: insurers } = await supabase.from("insurance_companies").select("id, name_en, name_ar, default_coverage_percent, active").order("name_en")
  return (
    <InvoiceCheckout
      bundle={bundle}
      insurers={(insurers ?? []) as { id: string; name_en: string; name_ar: string; default_coverage_percent: number | null; active: boolean }[]}
    />
  )
}
