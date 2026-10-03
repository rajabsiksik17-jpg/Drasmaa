import "server-only"
import { createClient } from "@/lib/supabase/server"
import type { HistoryExamData } from "@/components/medical/history-exam-form"

/** All patient-level master history rows (one per table per patient). */
export async function getHistoryExamData(patientId: string): Promise<Omit<HistoryExamData, "visit" | "visitDate"> | null> {
  const supabase = await createClient()
  const one = (table: string) => supabase.from(table).select("*").eq("patient_id", patientId).maybeSingle()
  const [patient, husband, menstrual, obstetric, medical, surgical, medications, family, social, allergy] = await Promise.all([
    supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
    one("patient_husbands"),
    one("patient_menstrual_history"),
    one("patient_obstetric_history"),
    one("patient_medical_history"),
    one("patient_surgical_history"),
    one("patient_medications"),
    one("patient_family_history"),
    one("patient_social_history"),
    one("patient_allergies"),
  ])
  if (!patient.data || !menstrual.data || !medical.data) return null
  return {
    patient: patient.data,
    husband: husband.data,
    menstrual: menstrual.data,
    obstetric: obstetric.data,
    medical: medical.data,
    surgical: surgical.data,
    medications: medications.data,
    family: family.data,
    social: social.data,
    allergy: allergy.data,
  } as Omit<HistoryExamData, "visit" | "visitDate">
}
