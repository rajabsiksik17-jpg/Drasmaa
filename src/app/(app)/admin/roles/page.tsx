import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { PermissionMatrix } from "@/components/admin/permission-matrix"
import type { Permission, Role } from "@/types/db"

export const metadata = { title: "Roles & permissions" }

export default async function RolesPage() {
  await requirePagePermission(P.rolesManage)
  const t = await getTranslations("admin")
  const supabase = await createClient()
  const [{ data: roles }, { data: permissions }, { data: grants }] = await Promise.all([
    supabase.from("roles").select("*").order("sort_order"),
    supabase.from("permissions").select("*").order("sort_order"),
    supabase.from("role_permissions").select("role_id, permission_code"),
  ])
  return (
    <>
      <PageHeader title={t("roles")} description={t("rolesHint")} />
      <PermissionMatrix
        roles={(roles ?? []) as Role[]}
        permissions={(permissions ?? []) as Permission[]}
        grants={(grants ?? []).map((g) => `${g.role_id}:${g.permission_code}`)}
      />
    </>
  )
}
