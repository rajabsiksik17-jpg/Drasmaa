import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { SUPABASE_URL } from "@/lib/supabase/env"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { DoctorsManager } from "@/components/admin/doctors-manager"
import { DoctorSignatures } from "@/components/admin/doctor-signatures"
import type { Doctor, DoctorWorkingHours, Service } from "@/types/db"

export const metadata = { title: "Doctors" }

export default async function DoctorsPage() {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("admin")
  const locale = await getLocale()
  const supabase = await createClient()
  const [{ data: doctors }, { data: departments }, { data: profiles }, { data: hours }, { data: prices }, { data: services }] = await Promise.all([
    supabase.from("doctors").select("*").order("sort_order").order("display_name_en"),
    supabase.from("departments").select("id, name_en, name_ar, active").order("sort_order"),
    supabase.from("profiles").select("id, full_name, email, active").order("full_name"),
    supabase.from("doctor_working_hours").select("*").order("weekday").order("start_time"),
    supabase.from("doctor_service_prices").select("doctor_id, service_id, price_cash, price_insurance"),
    supabase.from("services").select("id, name_en, name_ar, price_cash, price_insurance, category, active").order("sort_order"),
  ])
  const list = (doctors ?? []) as Doctor[]
  return (
    <>
      <PageHeader title={t("doctors")} description={t("doctorsHint")} />
      <DoctorsManager
        doctors={list}
        departments={(departments ?? []).map((d) => ({ id: d.id as string, label: (locale === "ar" ? d.name_ar : d.name_en) as string }))}
        profiles={(profiles ?? []).filter((p) => p.active).map((p) => ({ id: p.id as string, label: `${p.full_name} (${p.email ?? ""})` }))}
        hours={(hours ?? []) as DoctorWorkingHours[]}
        prices={(prices ?? []) as { doctor_id: string; service_id: string; price_cash: number; price_insurance: number | null }[]}
        services={(services ?? []) as Pick<Service, "id" | "name_en" | "name_ar" | "price_cash" | "price_insurance" | "category" | "active">[]}
        photoBase={`${SUPABASE_URL}/storage/v1/object/public/clinic-assets`}
      />
      <DoctorSignatures
        doctors={list.map((d) => ({
          id: d.id,
          name: locale === "ar" ? d.display_name_ar || d.display_name_en : d.display_name_en,
          hasSignature: !!d.signature_path,
          active: d.active,
        }))}
      />
    </>
  )
}
