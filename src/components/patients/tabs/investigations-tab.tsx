import { getTranslations } from "next-intl/server"
import { TestTube2 } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import type { Investigation, InvestigationResult } from "@/types/db"
import { EmptyState, SectionCard } from "@/components/common/page"
import { AddResultButton, ResultsHistory, RequestedList } from "@/components/patients/investigations-client"
import { ExportMenu } from "@/components/documents/export-menu"

export async function InvestigationsTab({ patientId }: { patientId: string }) {
  const session = (await getSession())!
  const t = await getTranslations("investigations")
  const supabase = await createClient()
  const [results, requested] = await Promise.all([
    supabase.from("investigation_results").select("*").eq("patient_id", patientId).order("result_date", { ascending: false }).limit(500),
    supabase.from("investigations").select("*").eq("patient_id", patientId).neq("status", "cancelled").order("requested_on", { ascending: false }).limit(200),
  ])
  const rows = (results.data ?? []) as InvestigationResult[]
  const canEdit = hasPermission(session, P.investigationsEdit)
  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-2">
        {rows.length > 0 && <ExportMenu target={{ type: "investigations", entityId: patientId, patientId }} />}
        {canEdit && <AddResultButton patientId={patientId} />}
      </div>
      <SectionCard title={t("results")} icon={TestTube2}>
        {rows.length === 0 ? <EmptyState icon={TestTube2} title={t("noResults")} /> : <ResultsHistory rows={rows} patientId={patientId} />}
      </SectionCard>
      <SectionCard title={t("requestedTitle")}>
        <RequestedList rows={(requested.data ?? []) as Investigation[]} patientId={patientId} />
      </SectionCard>
    </div>
  )
}
