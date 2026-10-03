import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { ConfigEditor } from "@/components/admin/config-editor"

export const metadata = { title: "Insurance" }

export default async function InsurancePage() {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("admin")
  const supabase = await createClient()
  const { data } = await supabase.from("insurance_companies").select("*").order("sort_order").order("name_en")
  return (
    <>
      <PageHeader title={t("insurance")} description={t("insuranceHint")} />
      <ConfigEditor
        table="insurance_companies"
        rows={data ?? []}
        columns={[
          { key: "name_en", label: t("nameEn"), dir: "ltr" },
          { key: "name_ar", label: t("nameAr"), dir: "rtl" },
          { key: "code", label: t("code"), type: "code", dir: "ltr", width: "140px" },
        ]}
      />
    </>
  )
}
