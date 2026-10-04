import { getPatientContext } from "@/lib/data/patient"
import { PatientHeader } from "@/components/patients/patient-header"
import { RealtimeRefresh } from "@/components/realtime-refresh"

export default async function PatientLayout({ children, params }: LayoutProps<"/patients/[patientId]">) {
  const { patientId } = await params
  const ctx = await getPatientContext(patientId)
  return (
    <div className="space-y-5">
      {/* Any change to this patient's identity, husband, allergy or today's
          appointment re-renders the header for every viewer. */}
      <RealtimeRefresh
        channel={`patient:${patientId}`}
        specs={[
          { table: "patients", filter: `id=eq.${patientId}` },
          { table: "patient_husbands", filter: `patient_id=eq.${patientId}` },
          { table: "patient_allergies", filter: `patient_id=eq.${patientId}` },
          { table: "appointments", filter: `patient_id=eq.${patientId}` },
          { table: "encounters", filter: `patient_id=eq.${patientId}` },
        ]}
      />
      <PatientHeader ctx={ctx} />
      {children}
    </div>
  )
}
