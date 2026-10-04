"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize, hasPermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { clinicToday } from "@/lib/dates"
import type { EncounterStatus } from "@/types/db"

const createSchema = z.object({
  patientId: z.uuid(),
  doctorId: z.uuid().nullable().optional(),
  serviceId: z.uuid().nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  paymentMethod: z.enum(["cash", "insurance"]).nullable().optional(),
  insuranceCompanyId: z.uuid().nullable().optional(),
  noCharge: z.boolean().optional(),
})

function revalidateQueue(patientId?: string) {
  revalidatePath("/today")
  revalidatePath("/dashboard")
  if (patientId) revalidatePath(`/patients/${patientId}`, "layout")
}

/**
 * "Create visit now": the patient is in the clinic (walk-in or without a
 * booking). The database stamps the arrival time, opens the bill
 * (registration on the first visit + the service) and queues the patient
 * according to the payment workflow. Calling it twice returns the same visit.
 */
export async function createEncounter(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string; invoiceId: string | null }>> {
  const auth = await authorize(P.encountersCreate)
  if (auth.error) return auth.error
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  if (v.paymentMethod === "insurance" && !v.insuranceCompanyId) return fail("validation", ["insurance_company_id"])
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_encounter", {
    p_patient: v.patientId,
    p_doctor: v.doctorId ?? null,
    p_service: v.serviceId ?? null,
    p_reason: v.reason || null,
    p_payment_method: v.paymentMethod ?? null,
    p_insurance: v.paymentMethod === "insurance" ? (v.insuranceCompanyId ?? null) : null,
    p_no_charge: !!v.noCharge,
  })
  if (error) return dbFail("createEncounter", error)
  const id = data as string
  let invoiceId: string | null = null
  if (hasPermission(auth.session, P.accountingView) || hasPermission(auth.session, P.billingCharge)) {
    const { data: inv } = await supabase.from("invoices").select("id").eq("encounter_id", id).neq("status", "void").maybeSingle()
    invoiceId = inv?.id ?? null
  }
  revalidateQueue(v.patientId)
  return ok({ id, invoiceId })
}

const STATUS = z.enum(["waiting_doctor", "with_doctor", "awaiting_checkout", "checked_out", "cancelled"])

/** Queue moves; every move is permission-checked again in the database. */
export async function setEncounterStatus(input: {
  id: string
  status: Exclude<EncounterStatus, "waiting_payment">
  reason?: string | null
}): Promise<ActionResult<void>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const parsed = z.object({ id: z.uuid(), status: STATUS, reason: z.string().trim().max(500).nullable().optional() }).safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient({ auditReason: parsed.data.reason })
  const { error } = await supabase.rpc("set_encounter_status", {
    p_encounter: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason || null,
  })
  if (error) return dbFail("setEncounterStatus", error)
  const { data: row } = await supabase.from("encounters").select("patient_id").eq("id", parsed.data.id).maybeSingle()
  revalidateQueue(row?.patient_id)
  return ok(undefined)
}

/** Bill of a clinic visit (created with the visit), for checkout links. */
export async function encounterInvoice(encounterId: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.accountingView, P.billingCharge)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(encounterId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase.from("invoices").select("id").eq("encounter_id", encounterId).neq("status", "void").maybeSingle()
  if (error) return dbFail("encounterInvoice", error)
  if (!data) return fail("notFound")
  return ok(data)
}

export interface WalkInDefaults {
  payment_method: "cash" | "insurance"
  insurance_company_id: string | null
  assigned_doctor_id: string | null
  /** No earlier visit: the registration (file opening) fee will be added. */
  first_visit: boolean
  /** Already registered today and not checked out (opening again returns it). */
  open_encounter_id: string | null
}

/** Defaults for "Create visit now" (payment from the patient file, first-visit fee). */
export async function getWalkInDefaults(patientId: string): Promise<ActionResult<WalkInDefaults>> {
  const auth = await authorize(P.encountersCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const [patient, visits, encounters, open] = await Promise.all([
    supabase.from("patients").select("payment_method, insurance_company_id, assigned_doctor_id").eq("id", patientId).maybeSingle(),
    supabase.from("visits").select("id", { count: "exact", head: true }).eq("patient_id", patientId).neq("status", "cancelled"),
    supabase.from("encounters").select("id", { count: "exact", head: true }).eq("patient_id", patientId).neq("status", "cancelled"),
    supabase
      .from("encounters")
      .select("id")
      .eq("patient_id", patientId)
      .eq("queue_date", clinicToday())
      .not("status", "in", "(checked_out,cancelled)")
      .limit(1)
      .maybeSingle(),
  ])
  if (patient.error) return dbFail("getWalkInDefaults", patient.error)
  if (!patient.data) return fail("notFound")
  return ok({
    payment_method: patient.data.payment_method as "cash" | "insurance",
    insurance_company_id: patient.data.insurance_company_id,
    assigned_doctor_id: patient.data.assigned_doctor_id,
    first_visit: (visits.count ?? 0) === 0 && (encounters.count ?? 0) === 0,
    open_encounter_id: open.data?.id ?? null,
  })
}
