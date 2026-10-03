import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { DocumentTemplatesEditor, type DocumentTemplateRow } from "@/components/admin/document-templates"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("documentTemplates") }
}

export default async function DocumentTemplatesPage() {
  const session = await requirePagePermission(P.templatesEdit)
  const t = await getTranslations("docTemplates")
  const supabase = await createClient()
  const [{ data }, { data: settings }] = await Promise.all([
    supabase.from("document_templates").select("*").order("document_type"),
    supabase.from("clinic_settings").select("generated_document_retention_days, version").eq("id", 1).single(),
  ])
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DocumentTemplatesEditor
        templates={(data ?? []) as DocumentTemplateRow[]}
        retentionDays={settings?.generated_document_retention_days ?? null}
        canRetention={hasPermission(session, P.settingsManage)}
      />
    </div>
  )
}
