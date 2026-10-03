import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { AuthenticationSettings, type SecurityPolicy } from "@/components/admin/authentication-settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("authentication") }
}

export default async function AuthenticationPage() {
  await requirePagePermission(P.securityManage)
  const t = await getTranslations("authSettings")
  const supabase = await createClient()
  const [{ data: policy }, { data: roles }, { data: required }, { data: account }] = await Promise.all([
    supabase.from("auth_security_settings").select("*").eq("id", 1).single(),
    supabase.from("roles").select("id, code, name_en, name_ar, active").order("sort_order"),
    supabase.from("otp_role_requirements").select("role_id"),
    supabase.from("email_accounts").select("smtp_status").eq("is_default", true).maybeSingle(),
  ])
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AuthenticationSettings
        policy={policy as SecurityPolicy}
        roles={(roles ?? []).filter((r) => r.active)}
        requiredRoles={(required ?? []).map((r) => r.role_id as string)}
        emailReady={account?.smtp_status === "ok"}
      />
    </div>
  )
}
