import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { AuditTable } from "@/components/admin/audit-table"
import { Pager } from "@/components/appointments/appointment-filters"
import { cn } from "@/lib/utils"
import type { AuditLog } from "@/types/db"

export const metadata = { title: "Audit log" }

const PAGE = 50
const ENTITIES = ["patients", "patient_allergies", "patient_medical_history", "appointments", "visits", "fertility_cycles", "documents", "role_permissions", "profiles", "clinic_settings"]

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requirePagePermission(P.auditView)
  const t = await getTranslations("admin")
  const sp = await searchParams
  const entity = typeof sp.entity === "string" && ENTITIES.includes(sp.entity) ? sp.entity : null
  const page = Math.max(0, Number(sp.page ?? 0) || 0)
  const supabase = await createClient()
  let q = supabase.from("audit_logs").select("*", { count: "exact" }).order("occurred_at", { ascending: false })
  if (entity) q = q.eq("entity_type", entity)
  const [{ data, count }, { data: profiles }] = await Promise.all([
    q.range(page * PAGE, page * PAGE + PAGE - 1),
    supabase.from("profiles").select("id, full_name"),
  ])
  return (
    <>
      <PageHeader title={t("audit")} description={t("auditHint")} />
      <div className="flex flex-wrap gap-1">
        <Link href="?" className={cn("rounded-full border px-3 py-1 text-xs font-medium", !entity ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
          {t("allEntities")}
        </Link>
        {ENTITIES.map((e) => (
          <Link
            key={e}
            href={`?entity=${e}`}
            className={cn("rounded-full border px-3 py-1 font-mono text-[11px]", entity === e ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {e}
          </Link>
        ))}
      </div>
      <AuditTable rows={(data ?? []) as AuditLog[]} actors={Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]))} />
      <Pager page={page} pageSize={PAGE} total={count ?? 0} />
    </>
  )
}
