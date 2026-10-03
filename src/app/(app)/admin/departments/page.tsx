import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { ConfigEditor } from "@/components/admin/config-editor"

export const metadata = { title: "Departments" }

export default async function DepartmentsPage() {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("admin")
  const supabase = await createClient()
  const { data } = await supabase.from("departments").select("*").order("sort_order")
  return (
    <>
      <PageHeader title={t("departments")} description={t("departmentsHint")} />
      <ConfigEditor
        table="departments"
        rows={data ?? []}
        columns={[
          { key: "code", label: t("code"), type: "code", immutable: true, dir: "ltr", width: "140px" },
          { key: "name_en", label: t("nameEn"), dir: "ltr" },
          { key: "name_ar", label: t("nameAr"), dir: "rtl" },
        ]}
      />
    </>
  )
}
