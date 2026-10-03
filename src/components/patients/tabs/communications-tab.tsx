import { CommunicationHistory } from "@/components/patients/communication-history"
import { listCommunications } from "@/lib/actions/messages"

export async function CommunicationsTab({ patientId }: { patientId: string }) {
  const res = await listCommunications(patientId)
  return <CommunicationHistory patientId={patientId} initial={res.ok ? res.data : []} />
}
