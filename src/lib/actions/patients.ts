"use server"

import { revalidatePath } from "next/cache"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, logDbError, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { limit } from "@/lib/security/rate-limit"
import { newPatientSchema, type NewPatientInput } from "@/lib/validation/patient"

export interface DuplicateCandidate {
  id: string
  patient_code: string
  full_name: string
  dob: string | null
  phone: string | null
  reasons: ("phone" | "name" | "dob")[]
  score: number
}

export async function findDuplicates(input: {
  name: string
  phone?: string
  dob?: string | null
}): Promise<ActionResult<DuplicateCandidate[]>> {
  const auth = await authorize(P.patientsCreate, P.patientsView)
  if (auth.error) return auth.error
  if ((input.name ?? "").trim().length < 2 && (input.phone ?? "").replace(/\D/g, "").length < 7) {
    return ok([])
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("find_possible_duplicates", {
    p_name: input.name ?? "",
    p_phone: input.phone || null,
    p_dob: input.dob || null,
  })
  if (error) return dbFail("findDuplicates", error)
  return ok((data ?? []) as DuplicateCandidate[])
}

export async function createPatient(input: NewPatientInput): Promise<ActionResult<{ id: string; patient_code: string }>> {
  const auth = await authorize(P.patientsCreate)
  if (auth.error) return auth.error
  if (!(await limit("patientCreatePerUser", auth.session.userId))) return fail("rateLimited")
  const parsed = newPatientSchema.safeParse(input)
  if (!parsed.success) {
    return fail("validation", parsed.error.issues.map((i) => i.path.join(".")))
  }
  const { husband, assigned_doctor_id, ...patient } = parsed.data
  const supabase = await createClient()

  // Normalise optional values: "" / undefined -> null. Dates are already ISO
  // yyyy-MM-dd (Postgres `date`), produced by the DD/MM/YYYY date input.
  const clean = <T extends Record<string, unknown>>(o: T) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === "" || v === undefined ? null : v])) as T
  const patientRow: Record<string, unknown> = clean({
    ...patient,
    insurance_company_id: patient.payment_method === "insurance" ? patient.insurance_company_id : null,
  })
  // The doctor is only sent when explicitly chosen (several active doctors).
  // With exactly one active doctor the database trigger assigns it itself.
  const doctorId = assigned_doctor_id && /^[0-9a-f-]{36}$/i.test(assigned_doctor_id) ? assigned_doctor_id : null
  if (doctorId) patientRow.assigned_doctor_id = doctorId
  const husbandRow = clean(husband)
  const hasHusband = Object.values(husbandRow).some((v) => v != null)

  // Preferred path: one transaction (patient + husband) in the database.
  const rpc = await supabase.rpc("create_patient", { p_patient: patientRow, p_husband: hasHusband ? husbandRow : {} })
  if (!rpc.error) {
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { id: string; patient_code: string } | undefined
    if (!row) return dbFail("createPatient (no row returned)", { code: "unexpected" })
    revalidatePath("/patients")
    return ok(row)
  }
  if (rpc.error.code !== "PGRST202") return dbFail("createPatient", rpc.error)

  // Fallback while migration 0009 is not applied yet (function not found).
  console.warn("[db] createPatient: create_patient() missing — run `npx supabase db push`. Using two-step insert.")
  const { data, error } = await supabase.from("patients").insert(patientRow).select("id, patient_code").single()
  if (error) return dbFail("createPatient insert", error)
  if (hasHusband) {
    const { error: hErr } = await supabase.from("patient_husbands").update(husbandRow).eq("patient_id", data.id)
    if (hErr) {
      // The patient exists; report the partial failure instead of hiding it.
      logDbError("createPatient husband", hErr)
      return ok(data)
    }
  }
  revalidatePath("/patients")
  return ok(data)
}

export async function setPatientArchived(patientId: string, archived: boolean): Promise<ActionResult> {
  const auth = await authorize(P.patientsArchive)
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { error } = await supabase
    .from("patients")
    .update({ status: archived ? "archived" : "active" })
    .eq("id", patientId)
  if (error) return dbFail("setPatientArchived", error)
  revalidatePath(`/patients/${patientId}`)
  return ok(undefined)
}

export interface PatientSearchRow {
  id: string
  patient_code: string
  full_name: string
  dob: string | null
  phone: string | null
  status: string
  total: number
}

export async function searchPatients(query: string, page = 0, pageSize = 20): Promise<ActionResult<PatientSearchRow[]>> {
  const auth = await authorize(P.patientsView)
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("search_patients", {
    p_query: query.slice(0, 100),
    p_limit: pageSize,
    p_offset: page * pageSize,
  })
  if (error) return dbFail("searchPatients", error)
  return ok((data ?? []) as PatientSearchRow[])
}

export interface GlobalSearchResult {
  patients: { id: string; patient_code: string; full_name: string; dob: string | null; phone: string | null; status: string }[]
  appointments: {
    id: string
    scheduled_at: string
    status: string
    visit_type: string
    patient_id: string
    patient_name: string
    patient_code: string
    doctor_name_en: string
    doctor_name_ar: string
  }[]
  visits: {
    id: string
    visit_type: string
    status: string
    visit_date: string
    patient_id: string
    patient_name: string
    patient_code: string
  }[]
}

export async function globalSearch(query: string): Promise<ActionResult<GlobalSearchResult>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("search_global", { p_query: query.slice(0, 100) })
  if (error) return dbFail("globalSearch", error)
  return ok(data as GlobalSearchResult)
}
