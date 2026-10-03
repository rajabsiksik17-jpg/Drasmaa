import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { ClinicSettingsForm } from "@/components/admin/clinic-settings-form"
import { LogoUploader } from "@/components/admin/logo-uploader"
import { SUPABASE_URL } from "@/lib/supabase/env"
import type { ClinicSettings } from "@/types/db"

export const metadata = { title: "Clinic settings" }

export default async function ClinicSettingsPage() {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("admin")
  const supabase = await createClient()
  const { data } = await supabase.from("clinic_settings").select("*").eq("id", 1).single()
  return (
    <>
      <PageHeader title={t("clinic")} description={t("clinicHint")} />
      <div className="space-y-5">
        <LogoUploader
          primary={data?.logo_path ? `${SUPABASE_URL}/storage/v1/object/public/clinic-assets/${data.logo_path}` : null}
          secondary={data?.secondary_logo_path ? `${SUPABASE_URL}/storage/v1/object/public/clinic-assets/${data.secondary_logo_path}` : null}
        />
        <ClinicSettingsForm settings={data as ClinicSettings} />
      </div>
    </>
  )
}
