"use server"

import { revalidatePath } from "next/cache"
import { authorize, hasPermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
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

export async function createPatient(
  input: NewPatientInput,
): Promise<ActionResult<{ id: string; patient_code: string; encounter_id: string | null; invoice_id: string | null }>> {
  const auth = await authorize(P.patientsCreate)
  if (auth.error) return auth.error
  if (!(await limit("patientCreatePerUser", auth.session.userId))) return fail("rateLimited")
  const parsed = newPatientSchema.safeParse(input)
  if (!parsed.success) {
    return fail("validation", parsed.error.issues.map((i) => i.path.join(".")))
  }
  const { husband, assigned_doctor_id, visit, ...patient } = parsed.data
  if (visit && !hasPermission(auth.session, P.encountersCreate)) return fail("forbidden")
  const uuidOrNull = (v: string | null | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
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
  const doctorId = uuidOrNull(assigned_doctor_id)
  if (doctorId) patientRow.assigned_doctor_id = doctorId
  const husbandRow = clean(husband)
  const hasHusband = Object.values(husbandRow).some((v) => v != null)
  const visitRow = visit
    ? { doctor_id: uuidOrNull(visit.doctor_id) ?? doctorId, service_id: uuidOrNull(visit.service_id), reason: visit.reason || null, no_charge: !!visit.no_charge }
    : null

  // One transaction: patient + husband (+ clinic visit, registration fee and
  // service lines). Nothing is kept if any step fails.
  const rpc = await supabase.rpc("create_patient", { p_patient: patientRow, p_husband: hasHusband ? husbandRow : {}, p_visit: visitRow })
  if (rpc.error) return dbFail("createPatient", rpc.error)
  const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { id: string; patient_code: string; encounter_id: string | null } | undefined
  if (!row) return dbFail("createPatient (no row returned)", { code: "unexpected" })
  revalidatePath("/patients")
  let invoiceId: string | null = null
  if (row.encounter_id) {
    revalidatePath("/appointments")
    if (hasPermission(auth.session, P.accountingView)) {
      const { data: inv } = await supabase.from("invoices").select("id").eq("encounter_id", row.encounter_id).neq("status", "void").maybeSingle()
      invoiceId = inv?.id ?? null
    }
  }
  return ok({ ...row, invoice_id: invoiceId })
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
