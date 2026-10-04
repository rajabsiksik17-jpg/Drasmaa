import { createClient } from "@/lib/supabase/server"
import { SectionCard } from "@/components/common/page"
import { UnifiedTimeline } from "@/components/patients/unified-timeline"
import { ExportMenu } from "@/components/documents/export-menu"
import type { TimelineEvent } from "@/types/db"

export async function TimelineTab({ patientId }: { patientId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("patient_timeline")
    .select("*")
    .eq("patient_id", patientId)
    .order("occurred_at", { ascending: false })
    .limit(500)
  const events = (data ?? []) as TimelineEvent[]
  // Names of the people who acted (one small query for the visible events).
  const actorIds = [...new Set(events.map((e) => e.actor_id).filter((x): x is string => !!x))]
  const { data: actors } = actorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [] }
  const people = Object.fromEntries((actors ?? []).map((p) => [p.id as string, p.full_name as string]))
  return (
    <SectionCard className="mx-auto max-w-3xl" actions={<ExportMenu target={{ type: "timeline", entityId: patientId, patientId }} />}>
      <UnifiedTimeline patientId={patientId} events={events} people={people} />
    </SectionCard>
  )
}
