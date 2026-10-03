import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { TemplatesManager } from "@/components/admin/templates-manager"
import type { MessageTemplate } from "@/lib/actions/templates"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("templates") }
}

export default async function TemplatesPage() {
  const session = await requirePagePermission(P.templatesView)
  const t = await getTranslations("templates")
  const supabase = await createClient()
  const [{ data: templates }, { data: profiles }, { data: clinic }] = await Promise.all([
    supabase.from("message_templates").select("*").order("channel").order("sort_order").order("created_at"),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("clinic_settings").select("clinic_name_en, clinic_name_ar, phone, address_en, address_ar").eq("id", 1).single(),
  ])
  const names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]))
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TemplatesManager
        templates={(templates ?? []) as MessageTemplate[]}
        userNames={names}
        clinic={{
          en: { name: clinic?.clinic_name_en ?? "", phone: clinic?.phone ?? "", address: clinic?.address_en ?? "" },
          ar: { name: clinic?.clinic_name_ar ?? "", phone: clinic?.phone ?? "", address: clinic?.address_ar ?? clinic?.address_en ?? "" },
        }}
        can={{
          create: hasPermission(session, P.templatesCreate),
          edit: hasPermission(session, P.templatesEdit),
          delete: hasPermission(session, P.templatesDelete),
        }}
        userEmail={session.email ?? ""}
      />
    </div>
  )
}
