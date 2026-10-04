import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { BillingSettings } from "@/components/admin/billing-settings"
import type { ClinicSettings, Role } from "@/types/db"

export const metadata = { title: "Billing settings" }

export default async function BillingSettingsPage() {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("billingSettings")
  const locale = await getLocale()
  const supabase = await createClient()
  const [{ data: settings, error }, { data: roles }, { data: registration }] = await Promise.all([
    supabase
      .from("clinic_settings")
      .select("collect_payment_before_consultation, enforce_working_hours, working_days, payment_methods, version, working_hours_start, working_hours_end")
      .eq("id", 1)
      .single(),
    supabase.from("roles").select("id, code, name_en, name_ar, max_discount_percent, active").order("sort_order"),
    supabase.from("services").select("name_en, name_ar, price_cash, active").eq("auto_trigger", "registration").order("active", { ascending: false }).limit(1).maybeSingle(),
  ])
  // A missing column means the database migrations were not applied yet.
  if (error || !settings) throw new Error("Billing settings are not available. Apply the latest database migrations.")
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <BillingSettings
        settings={settings as Pick<ClinicSettings, "collect_payment_before_consultation" | "enforce_working_hours" | "working_days" | "payment_methods" | "version" | "working_hours_start" | "working_hours_end">}
        roles={(roles ?? []) as Pick<Role, "id" | "code" | "name_en" | "name_ar" | "max_discount_percent" | "active">[]}
        registration={
          registration
            ? { name: (locale === "ar" ? registration.name_ar : registration.name_en) as string, price: Number(registration.price_cash), active: !!registration.active }
            : null
        }
      />
    </>
  )
}
