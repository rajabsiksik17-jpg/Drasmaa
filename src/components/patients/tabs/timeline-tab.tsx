import { createClient } from "@/lib/supabase/server"
import { SectionCard } from "@/components/common/page"
import { PatientTimeline } from "@/components/patients/patient-timeline"
import { ExportMenu } from "@/components/documents/export-menu"
import type { TimelineEvent } from "@/types/db"

export async function TimelineTab({ patientId }: { patientId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("patient_timeline")
    .select("*")
    .eq("patient_id", patientId)
    .order("occurred_at", { ascending: false })
    .limit(300)
  return (
    <SectionCard className="mx-auto max-w-3xl" actions={<ExportMenu target={{ type: "timeline", entityId: patientId, patientId }} />}>
      <PatientTimeline patientId={patientId} events={(data ?? []) as TimelineEvent[]} />
    </SectionCard>
  )
}
