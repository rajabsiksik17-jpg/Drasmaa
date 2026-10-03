import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { WhatsappSettings } from "@/components/admin/whatsapp-settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("whatsapp") }
}

export default async function WhatsappSettingsPage() {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("whatsappSettings")
  const supabase = await createClient()
  const { data } = await supabase.from("clinic_settings").select("whatsapp_enabled, whatsapp_country_code, whatsapp_open_mode").eq("id", 1).single()
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <WhatsappSettings
        initial={{
          whatsapp_enabled: data?.whatsapp_enabled ?? true,
          whatsapp_country_code: data?.whatsapp_country_code ?? "962",
          whatsapp_open_mode: (data?.whatsapp_open_mode as "auto" | "web" | "app") ?? "auto",
        }}
      />
    </div>
  )
}
