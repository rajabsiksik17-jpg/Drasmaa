import { createClient } from "@/lib/supabase/server"
import { AuditTable } from "@/components/admin/audit-table"
import type { AuditLog } from "@/types/db"

export async function AuditTab({ patientId }: { patientId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("patient_id", patientId)
    .order("occurred_at", { ascending: false })
    .limit(200)
  const { data: profiles } = await supabase.from("profiles").select("id, full_name")
  return <AuditTable rows={(data ?? []) as AuditLog[]} actors={Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]))} />
}
