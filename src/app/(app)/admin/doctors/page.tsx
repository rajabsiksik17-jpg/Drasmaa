import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { ConfigEditor } from "@/components/admin/config-editor"
import { DoctorSignatures } from "@/components/admin/doctor-signatures"

export const metadata = { title: "Doctors" }

export default async function DoctorsPage() {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("admin")
  const locale = await getLocale()
  const supabase = await createClient()
  const [{ data: doctors }, { data: departments }, { data: profiles }] = await Promise.all([
    supabase.from("doctors").select("*").order("sort_order").order("display_name_en"),
    supabase.from("departments").select("id, name_en, name_ar").order("sort_order"),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ])
  return (
    <>
      <PageHeader title={t("doctors")} description={t("doctorsHint")} />
      <ConfigEditor
        table="doctors"
        rows={doctors ?? []}
        columns={[
          { key: "display_name_en", label: t("nameEn"), dir: "ltr" },
          { key: "display_name_ar", label: t("nameAr"), dir: "rtl" },
          {
            key: "department_id",
            label: t("department"),
            type: "select",
            options: (departments ?? []).map((d) => ({ value: d.id, label: locale === "ar" ? d.name_ar : d.name_en })),
          },
          {
            key: "profile_id",
            label: t("loginAccount"),
            type: "select",
            options: (profiles ?? []).map((p) => ({ value: p.id, label: `${p.full_name} (${p.email})` })),
          },
          { key: "specialty", label: t("specialty") },
          { key: "title_en", label: t("titleEn"), dir: "ltr" },
          { key: "title_ar", label: t("titleAr"), dir: "rtl" },
          { key: "color", label: t("color"), type: "color", width: "70px" },
        ]}
      />
      <DoctorSignatures
        doctors={(doctors ?? []).map((d) => ({
          id: d.id as string,
          name: (locale === "ar" ? d.display_name_ar || d.display_name_en : d.display_name_en) as string,
          hasSignature: !!d.signature_path,
          active: d.active as boolean,
        }))}
      />
    </>
  )
}
