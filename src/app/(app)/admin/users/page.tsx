import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { UsersManager } from "@/components/admin/users-manager"
import type { Department, Profile, Role } from "@/types/db"

export const metadata = { title: "Users" }

export default async function UsersPage() {
  const session = await requirePagePermission(P.usersManage)
  const t = await getTranslations("admin")
  const supabase = await createClient()
  const [{ data: profiles }, { data: roles }, { data: departments }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("roles").select("*").order("sort_order"),
    supabase.from("departments").select("*").order("sort_order"),
  ])
  return (
    <>
      <PageHeader title={t("users")} description={t("usersHint")} />
      <UsersManager
        currentUserId={session.userId}
        profiles={(profiles ?? []) as Profile[]}
        roles={(roles ?? []) as Role[]}
        departments={(departments ?? []) as Department[]}
      />
    </>
  )
}
