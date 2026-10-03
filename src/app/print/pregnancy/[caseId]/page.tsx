import { notFound } from "next/navigation"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { ageFromDob } from "@/lib/dates"
import { PrintPregnancy } from "@/components/print/print-views"
import type { Patient, PatientHusband, PregnancyCase, PregnancyFollowup } from "@/types/db"

export default async function PrintPregnancyPage({ params }: PageProps<"/print/pregnancy/[caseId]">) {
  await requirePagePermission(P.pregnancyView)
  const { caseId } = await params
  if (!/^[0-9a-f-]{36}$/.test(caseId)) notFound()
  const supabase = await createClient()
  const { data: pcase } = await supabase.from("pregnancy_cases").select("*").eq("id", caseId).maybeSingle()
  if (!pcase) notFound()
  const [{ data: patient }, { data: husband }, { data: followups }] = await Promise.all([
    supabase.from("patients").select("*").eq("id", pcase.patient_id).single(),
    supabase.from("patient_husbands").select("*").eq("patient_id", pcase.patient_id).maybeSingle(),
    supabase.from("pregnancy_followups").select("*").eq("pregnancy_case_id", caseId).order("visit_no"),
  ])
  const p = patient as Patient
  const h = husband as PatientHusband | null
  return (
    <PrintPregnancy
      pcase={pcase as PregnancyCase}
      followups={(followups ?? []) as PregnancyFollowup[]}
      patient={{
        full_name: p.full_name,
        age: ageFromDob(p.dob),
        patient_code: p.patient_code,
        wifeBlood: [p.blood_group, p.rh].filter(Boolean).join(" "),
        husbandBlood: [h?.blood_group, h?.rh].filter(Boolean).join(" "),
      }}
    />
  )
}
