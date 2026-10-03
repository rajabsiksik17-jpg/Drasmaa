"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import type { Medication, Prescription, PrescriptionItem } from "@/types/db"

/** Catalog-only suggestions (configured medications, ranked by use). */
export async function searchMedications(query: string): Promise<ActionResult<Medication[]>> {
  const auth = await authorize(P.prescriptionsCreate, P.prescriptionsView, P.medicationsManage)
  if (auth.error) return auth.error
  const q = query.trim().slice(0, 60).replace(/[%_\\]/g, "")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("search_medications", { p_query: q, p_limit: 12 })
  if (error) return dbFail("searchMedications", error)
  return ok((data ?? []) as Medication[])
}

/** The visit's draft prescription (created on first medication). */
export async function ensureVisitPrescription(visitId: string): Promise<ActionResult<Prescription>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(visitId).success) return fail("validation")
  const supabase = await createClient()
  const { data: existing } = await supabase.from("prescriptions").select("*").eq("visit_id", visitId).eq("status", "draft").order("created_at").limit(1).maybeSingle()
  if (existing) return ok(existing as Prescription)
  const { data: visit } = await supabase.from("visits").select("patient_id, doctor_id, status").eq("id", visitId).maybeSingle()
  if (!visit) return fail("notFound")
  if (visit.status === "cancelled") return fail("visitCancelled")
  const { data, error } = await supabase
    .from("prescriptions")
    .insert({ patient_id: visit.patient_id, visit_id: visitId, doctor_id: visit.doctor_id ?? auth.session.doctor?.id ?? null })
    .select("*")
    .single()
  if (error) return dbFail("ensureVisitPrescription", error)
  return ok(data as Prescription)
}

/** A prescription outside a visit (e.g. renewal from the patient profile). */
export async function createPrescription(patientId: string): Promise<ActionResult<Prescription>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("prescriptions")
    .insert({ patient_id: patientId, doctor_id: auth.session.doctor?.id ?? null })
    .select("*")
    .single()
  if (error) return dbFail("createPrescription", error)
  revalidatePath(`/patients/${patientId}`)
  return ok(data as Prescription)
}

const text = (max: number) => z.string().trim().max(max).nullable().optional()
const itemSchema = z.object({
  prescriptionId: z.uuid(),
  medicationId: z.uuid().nullable().optional(),
  medication_name: z.string().trim().min(1).max(200),
  generic_name: text(160),
  strength: text(60),
  form: text(60),
  dose: text(80),
  route: text(60),
  frequency: text(80),
  duration: text(60),
  quantity: text(40),
  instructions: text(500),
  notes: text(500),
})

export async function addPrescriptionItem(input: z.input<typeof itemSchema>): Promise<ActionResult<PrescriptionItem>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  const parsed = itemSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { prescriptionId, medicationId, ...item } = parsed.data
  const supabase = await createClient()
  const { data: last } = await supabase.from("prescription_items").select("sort_order").eq("prescription_id", prescriptionId).order("sort_order", { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await supabase
    .from("prescription_items")
    .insert({ ...item, prescription_id: prescriptionId, medication_id: medicationId ?? null, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("*")
    .single()
  if (error) return dbFail("addPrescriptionItem", error)
  return ok(data as PrescriptionItem)
}

const updateItemSchema = itemSchema.omit({ prescriptionId: true, medicationId: true }).partial().extend({ id: z.uuid() })

export async function updatePrescriptionItem(input: z.input<typeof updateItemSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  const parsed = updateItemSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { id, ...patch } = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.from("prescription_items").update(patch).eq("id", id)
  if (error) return dbFail("updatePrescriptionItem", error)
  return ok(undefined)
}

export async function removePrescriptionItem(id: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("prescription_items").delete().eq("id", id)
  if (error) return dbFail("removePrescriptionItem", error)
  return ok(undefined)
}

export async function savePrescriptionNotes(id: string, notes: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success || notes.length > 2000) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("prescriptions").update({ notes: notes.trim() || null }).eq("id", id)
  if (error) return dbFail("savePrescriptionNotes", error)
  return ok(undefined)
}

/** Issue = the prescription becomes a fixed document (also done on visit completion). */
export async function issuePrescription(id: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase.from("prescriptions").update({ status: "issued" }).eq("id", id).select("patient_id").maybeSingle()
  if (error) return dbFail("issuePrescription", error)
  if (!data) return fail("notFound")
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

export async function cancelPrescription(id: string, reason: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.prescriptionsEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success || reason.trim().length < 3) return fail("validation", ["reason"])
  const supabase = await createClient({ auditReason: reason })
  const { data, error } = await supabase.from("prescriptions").update({ status: "cancelled" }).eq("id", id).select("patient_id").maybeSingle()
  if (error) return dbFail("cancelPrescription", error)
  if (!data) return fail("notFound")
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

/** Copy an issued/cancelled prescription into a new draft (renewal / correction). */
export async function duplicatePrescription(id: string, visitId?: string | null): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.prescriptionsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { data: src } = await supabase.from("prescriptions").select("*, items:prescription_items(*)").eq("id", id).maybeSingle()
  if (!src) return fail("notFound")
  const { data: rx, error } = await supabase
    .from("prescriptions")
    .insert({ patient_id: src.patient_id, visit_id: visitId ?? null, doctor_id: auth.session.doctor?.id ?? src.doctor_id, notes: src.notes })
    .select("id")
    .single()
  if (error) return dbFail("duplicatePrescription", error)
  const items = ((src.items ?? []) as PrescriptionItem[]).sort((a, b) => a.sort_order - b.sort_order)
  if (items.length) {
    const { error: iError } = await supabase.from("prescription_items").insert(
      items.map(({ id: _id, prescription_id: _p, created_at: _c, updated_at: _u, created_by: _cb, updated_by: _ub, version: _v, ...rest }) => ({ ...rest, prescription_id: rx.id })),
    )
    if (iError) return dbFail("duplicatePrescription.items", iError)
  }
  revalidatePath(`/patients/${src.patient_id}`)
  return ok({ id: rx.id })
}

const medicationSchema = z.object({
  id: z.uuid().optional(),
  name_en: z.string().trim().min(1).max(160),
  name_ar: text(160),
  generic_name: text(160),
  brand_name: text(160),
  strength: text(60),
  form: text(60),
  route: text(60),
  default_dose: text(80),
  default_frequency: text(80),
  default_duration: text(60),
  default_instructions: text(500),
  active: z.boolean().default(true),
})

/** Medication catalog (the only source of suggestions). */
export async function saveMedication(input: z.input<typeof medicationSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.medicationsManage)
  if (auth.error) return auth.error
  const parsed = medicationSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { id, ...row } = parsed.data
  const clean = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]))
  const supabase = await createClient()
  const { data, error } = id
    ? await supabase.from("medications").update(clean).eq("id", id).select("id").single()
    : await supabase.from("medications").insert(clean).select("id").single()
  if (error) return dbFail("saveMedication", error)
  revalidatePath("/admin/medications")
  return ok({ id: data.id })
}
