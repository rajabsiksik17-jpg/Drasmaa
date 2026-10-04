import "server-only"
import { cache } from "react"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { dayWindow } from "@/lib/data/appointments"
import { getOpenEncounter, type QueueEncounter } from "@/lib/data/encounters"
import { P } from "@/lib/permissions"
import { gestationalAge } from "@/lib/medical/calculations"
import type { Appointment, FertilityCase, FertilityCycle, Patient, PatientAllergy, PatientHusband, PregnancyCase } from "@/types/db"

export interface PatientContext {
  patient: Patient
  husband: PatientHusband | null
  allergy: PatientAllergy | null
  canSeeAllergy: boolean
  todayAppointment: Appointment | null
  activeFertilityCase: FertilityCase | null
  activePregnancy: PregnancyCase | null
  activeCycle: Pick<FertilityCycle, "id" | "cycle_number" | "fertility_case_id" | "started_at"> | null
  /** Today's open clinic visit (queue status + bill), if the patient is here. */
  openEncounter: QueueEncounter | null
  /** Gestational age of the active pregnancy (computed on the server: no hydration drift). */
  pregnancyGa: { weeks: number; days: number } | null
}

/** Everything the patient header needs; cached per request (layout + page share it). */
export const getPatientContext = cache(async (patientId: string): Promise<PatientContext> => {
  if (!/^[0-9a-f-]{36}$/.test(patientId)) notFound()
  const session = await getSession()
  const supabase = await createClient()
  const { data: patient } = await supabase.from("patients").select("*").eq("id", patientId).maybeSingle()
  if (!patient) notFound()

  const can = (c: (typeof P)[keyof typeof P]) => !!session && hasPermission(session, c)
  const today = dayWindow(0)
  const [husband, allergy, todayAppt, fcase, pcase, cycle, openEncounter] = await Promise.all([
    supabase.from("patient_husbands").select("*").eq("patient_id", patientId).maybeSingle(),
    can(P.allergyView) || can(P.medicalView)
      ? supabase.from("patient_allergies").select("*").eq("patient_id", patientId).maybeSingle()
      : Promise.resolve({ data: null }),
    can(P.appointmentsView)
      ? supabase
          .from("appointments")
          .select("*")
          .eq("patient_id", patientId)
          .gte("scheduled_at", today.start)
          .lt("scheduled_at", today.end)
          .in("status", ["scheduled", "checked_in", "with_doctor"])
          .order("scheduled_at")
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    can(P.fertilityView)
      ? supabase.from("fertility_cases").select("*").eq("patient_id", patientId).eq("status", "active").order("opened_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    can(P.pregnancyView)
      ? supabase.from("pregnancy_cases").select("*").eq("patient_id", patientId).eq("status", "active").maybeSingle()
      : Promise.resolve({ data: null }),
    can(P.oiView)
      ? supabase
          .from("fertility_cycles")
          .select("id, cycle_number, fertility_case_id, started_at")
          .eq("patient_id", patientId)
          .eq("status", "active")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    can(P.appointmentsView) || can(P.encountersCreate) || can(P.visitsCreate) || can(P.accountingView) ? getOpenEncounter(patientId) : Promise.resolve(null),
  ])

  return {
    patient: patient as Patient,
    husband: (husband.data as PatientHusband | null) ?? null,
    allergy: (allergy.data as PatientAllergy | null) ?? null,
    canSeeAllergy: can(P.allergyView) || can(P.medicalView),
    todayAppointment: (todayAppt.data as Appointment | null) ?? null,
    activeFertilityCase: (fcase.data as FertilityCase | null) ?? null,
    activePregnancy: (pcase.data as PregnancyCase | null) ?? null,
    activeCycle: (cycle.data as PatientContext["activeCycle"]) ?? null,
    openEncounter,
    pregnancyGa: gestationalAge((pcase.data as PregnancyCase | null)?.lmp ?? null),
  }
})
