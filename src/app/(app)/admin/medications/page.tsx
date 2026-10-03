import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { MedicationsManager } from "@/components/admin/medications-manager"
import type { Medication } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("medications") }
}

export default async function MedicationsPage() {
  await requirePagePermission(P.medicationsManage)
  const t = await getTranslations("medications")
  const supabase = await createClient()
  const { data } = await supabase.from("medications").select("*").order("name_en").order("strength")
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MedicationsManager medications={(data ?? []) as Medication[]} />
    </div>
  )
}
