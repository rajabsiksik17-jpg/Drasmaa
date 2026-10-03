import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { PricingManager } from "@/components/admin/pricing-manager"
import type { Service } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("pricing") }
}

export default async function PricingPage() {
  const session = await requirePagePermission(P.pricingView, P.pricingManage)
  const t = await getTranslations("pricing")
  const supabase = await createClient()
  const [{ data: services }, { data: insurers }, { data: special }, { data: packageItems }, { data: settings }] = await Promise.all([
    supabase.from("services").select("*").order("sort_order").order("name_en"),
    supabase.from("insurance_companies").select("id, name_en, name_ar, default_coverage_percent, active").order("name_en"),
    supabase.from("service_insurance_prices").select("service_id, insurance_company_id, price, coverage_percent"),
    supabase.from("service_package_items").select("package_id, service_id, quantity"),
    supabase.from("clinic_settings").select("currency").eq("id", 1).single(),
  ])
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <PricingManager
        services={(services ?? []) as Service[]}
        insurers={(insurers ?? []) as { id: string; name_en: string; name_ar: string; default_coverage_percent: number | null; active: boolean }[]}
        special={(special ?? []) as { service_id: string; insurance_company_id: string; price: number; coverage_percent: number | null }[]}
        packageItems={(packageItems ?? []) as { package_id: string; service_id: string; quantity: number }[]}
        currency={settings?.currency ?? "JOD"}
        canManage={hasPermission(session, P.pricingManage)}
      />
    </div>
  )
}
