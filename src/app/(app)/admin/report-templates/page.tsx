import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { ReportTemplatesManager } from "@/components/admin/report-templates-manager"
import type { ReportTemplate } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("reportTemplates") }
}

export default async function ReportTemplatesPage() {
  await requirePagePermission(P.reportsEdit)
  const t = await getTranslations("reportTemplates")
  const supabase = await createClient()
  const { data } = await supabase.from("report_templates").select("*").order("sort_order")
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ReportTemplatesManager templates={(data ?? []) as ReportTemplate[]} />
    </div>
  )
}
