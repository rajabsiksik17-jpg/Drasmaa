"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import type { DrawingStroke, VisitType } from "@/types/db"

const id = z.uuid()

// ---------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------
export async function startVisit(input: {
  patientId: string
  visitType: VisitType
  appointmentId?: string | null
  caseId?: string | null
}): Promise<ActionResult<{ visitId: string }>> {
  const auth = await authorize(P.visitsCreate)
  if (auth.error) return auth.error
  const parsed = z
    .object({
      patientId: id,
      visitType: z.enum(["pregnancy", "fertility", "gynecology"]),
      appointmentId: id.nullable().optional(),
      caseId: id.nullable().optional(),
    })
    .safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_visit", {
    p_patient: parsed.data.patientId,
    p_visit_type: parsed.data.visitType,
    p_appointment: parsed.data.appointmentId ?? null,
    p_case: parsed.data.caseId ?? null,
  })
  if (error) return dbFail("startVisit", error)
  revalidatePath(`/patients/${parsed.data.patientId}`)
  revalidatePath("/dashboard")
  return ok({ visitId: data as string })
}

export async function completeVisit(visitId: string): Promise<ActionResult> {
  const auth = await authorize(P.visitsComplete)
  if (auth.error) return auth.error
  if (!id.safeParse(visitId).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.rpc("complete_visit", { p_visit: visitId })
  if (error) return dbFail("completeVisit", error)
  revalidatePath("/dashboard")
  revalidatePath("/patients", "layout")
  return ok(undefined)
}

export async function cancelVisit(visitId: string, reason: string): Promise<ActionResult> {
  const auth = await authorize(P.visitsEdit)
  if (auth.error) return auth.error
  if (!id.safeParse(visitId).success || reason.trim().length < 3) return fail("validation", ["reason"])
  const supabase = await createClient({ auditReason: reason })
  const { data, error } = await supabase
    .from("visits")
    .update({ status: "cancelled", cancel_reason: reason.trim().slice(0, 500) })
    .eq("id", visitId)
    .in("status", ["draft", "in_progress"])
    .select("patient_id")
    .maybeSingle()
  if (error) return dbFail("cancelVisit", error)
  if (!data) return fail("invalidTransition")
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

export async function missingVisitFields(visitId: string): Promise<ActionResult<string[]>> {
  const auth = await authorize(P.visitsView)
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("visit_missing_fields", { p_visit: visitId })
  if (error) return dbFail("missingVisitFields", error)
  return ok((data ?? []) as string[])
}

// ---------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------
export async function createPregnancyCase(input: {
  patientId: string
  lmp?: string | null
}): Promise<ActionResult<{ id: string; case_number: number }>> {
  const auth = await authorize(P.pregnancyEdit)
  if (auth.error) return auth.error
  if (!id.safeParse(input.patientId).success) return fail("validation")
  const supabase = await createClient()
  const lmp = input.lmp && /^\d{4}-\d{2}-\d{2}$/.test(input.lmp) ? input.lmp : null
  const { data, error } = await supabase
    .from("pregnancy_cases")
    .insert({ patient_id: input.patientId, lmp })
    .select("id, case_number")
    .single()
  if (error) return dbFail("createPregnancyCase", error)
  revalidatePath(`/patients/${input.patientId}`)
  return ok(data)
}

export async function createFertilityCase(patientId: string): Promise<ActionResult<{ id: string; case_number: number }>> {
  const auth = await authorize(P.fertilityEdit)
  if (auth.error) return auth.error
  if (!id.safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("fertility_cases")
    .insert({ patient_id: patientId })
    .select("id, case_number")
    .single()
  if (error) return dbFail("createFertilityCase", error)
  revalidatePath(`/patients/${patientId}`)
  return ok(data)
}

export async function closeCase(input: {
  kind: "fertility" | "pregnancy"
  caseId: string
  outcome?: string | null
  reason?: string | null
}): Promise<ActionResult> {
  const auth = await authorize(input.kind === "fertility" ? P.fertilityEdit : P.pregnancyEdit)
  if (auth.error) return auth.error
  if (!id.safeParse(input.caseId).success) return fail("validation")
  const supabase = await createClient({ auditReason: input.reason })
  const table = input.kind === "fertility" ? "fertility_cases" : "pregnancy_cases"
  const patch: Record<string, unknown> = { status: "closed", closed_at: new Date().toISOString() }
  if (input.kind === "pregnancy" && input.outcome) patch.outcome = input.outcome.slice(0, 1000)
  const { data, error } = await supabase.from(table).update(patch).eq("id", input.caseId).select("patient_id").maybeSingle()
  if (error) return dbFail("closeCase", error)
  if (!data) return fail("notFound")
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

// ---------------------------------------------------------------------
// O/I cycles
// ---------------------------------------------------------------------
export async function startOiCycle(input: {
  fertilityCaseId: string
  visitId?: string | null
}): Promise<ActionResult<{ id: string; patient_id: string; cycle_number: number }>> {
  const auth = await authorize(P.oiEdit)
  if (auth.error) return auth.error
  const parsed = z.object({ fertilityCaseId: id, visitId: id.nullable().optional() }).safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()

  // Never create a second cycle by accident while one is active in this case.
  const { data: active } = await supabase
    .from("fertility_cycles")
    .select("id, patient_id, cycle_number")
    .eq("fertility_case_id", parsed.data.fertilityCaseId)
    .eq("status", "active")
    .maybeSingle()
  if (active) return ok(active)

  const { data, error } = await supabase
    .from("fertility_cycles")
    .insert({ fertility_case_id: parsed.data.fertilityCaseId, visit_id: parsed.data.visitId ?? null })
    .select("id, patient_id, cycle_number")
    .single()
  if (error) return dbFail("startOiCycle", error)
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(data)
}

export async function setCycleDay1(input: {
  cycleId: string
  date: string | null
  keepOverrides: boolean
  reason?: string | null
}): Promise<ActionResult> {
  const auth = await authorize(P.oiEdit)
  if (auth.error) return auth.error
  const parsed = z
    .object({
      cycleId: id,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      keepOverrides: z.boolean(),
    })
    .safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient({ auditReason: input.reason })
  const { error } = await supabase.rpc("set_cycle_day1", {
    p_cycle: parsed.data.cycleId,
    p_date: parsed.data.date,
    p_keep_overrides: parsed.data.keepOverrides,
  })
  if (error) return dbFail("setCycleDay1", error)
  return ok(undefined)
}

// ---------------------------------------------------------------------
// Investigation results captured inside a visit form (one per type/visit)
// ---------------------------------------------------------------------
export async function saveVisitResult(input: {
  patientId: string
  visitId: string
  typeCode: string
  value: string
  expectedVersion: number | null
  reason?: string | null
}): Promise<ActionResult<{ id: string; version: number } | null>> {
  const auth = await authorize(P.investigationsEdit)
  if (auth.error) return auth.error
  const parsed = z
    .object({
      patientId: id,
      visitId: id,
      typeCode: z.string().regex(/^[a-z0-9_]+$/),
      value: z.string().max(200),
    })
    .safeParse(input)
  if (!parsed.success) return fail("validation")
  const raw = parsed.data.value.trim()
  const numeric = raw !== "" && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null
  const values = { value_numeric: numeric, value_text: numeric == null && raw ? raw : null }
  const supabase = await createClient({ auditReason: input.reason })

  const { data: existing } = await supabase
    .from("investigation_results")
    .select("id, version")
    .eq("visit_id", parsed.data.visitId)
    .eq("type_code", parsed.data.typeCode)
    .maybeSingle()

  if (!existing) {
    if (!raw) return ok(null)
    const { data, error } = await supabase
      .from("investigation_results")
      .insert({ patient_id: parsed.data.patientId, visit_id: parsed.data.visitId, type_code: parsed.data.typeCode, ...values })
      .select("id, version")
      .single()
    if (error) return dbFail("saveVisitResult insert", error)
    return ok(data)
  }
  if (input.expectedVersion != null && existing.version !== input.expectedVersion) return fail("conflict")
  const { data, error } = await supabase
    .from("investigation_results")
    .update(values)
    .eq("id", existing.id)
    .eq("version", existing.version)
    .select("id, version")
    .maybeSingle()
  if (error) return dbFail("saveVisitResult update", error)
  if (!data) return fail("conflict")
  return ok(data)
}

export async function addInvestigationResult(input: {
  patientId: string
  typeCode: string
  value: string
  resultDate: string
  notes?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.investigationsEdit)
  if (auth.error) return auth.error
  const parsed = z
    .object({
      patientId: id,
      typeCode: z.string().regex(/^[a-z0-9_]+$/),
      value: z.string().trim().min(1).max(200),
      resultDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(1000).nullable().optional(),
    })
    .safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  const numeric = /^-?\d+(\.\d+)?$/.test(v.value) ? Number(v.value) : null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("investigation_results")
    .insert({
      patient_id: v.patientId,
      type_code: v.typeCode,
      value_numeric: numeric,
      value_text: numeric == null ? v.value : null,
      result_date: v.resultDate,
      notes: v.notes?.trim() || null,
    })
    .select("id")
    .single()
  if (error) return dbFail("addInvestigationResult", error)
  revalidatePath(`/patients/${v.patientId}`)
  return ok(data)
}

export async function requestInvestigations(input: {
  patientId: string
  visitId?: string | null
  typeCodes: string[]
}): Promise<ActionResult<{ count: number }>> {
  const auth = await authorize(P.investigationsEdit)
  if (auth.error) return auth.error
  const parsed = z
    .object({ patientId: id, visitId: id.nullable().optional(), typeCodes: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(40) })
    .safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("investigations").insert(
    parsed.data.typeCodes.map((type_code) => ({
      patient_id: parsed.data.patientId,
      visit_id: parsed.data.visitId ?? null,
      type_code,
    })),
  )
  if (error) return dbFail("requestInvestigations", error)
  revalidatePath(`/patients/${parsed.data.patientId}`)
  return ok({ count: parsed.data.typeCodes.length })
}

// ---------------------------------------------------------------------
// Ultrasound annotation layer
// ---------------------------------------------------------------------
const strokeSchema = z.object({
  id: z.string().max(40),
  tool: z.enum(["pen", "eraser", "spray"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  size: z.number().min(1).max(80),
  points: z.array(z.number().finite()).max(20000),
})

export async function saveAnnotation(input: {
  patientId: string
  visitId: string
  templateKey: string
  strokes: DrawingStroke[]
  width: number
  height: number
  expectedVersion: number | null
  reason?: string | null
}): Promise<ActionResult<{ id: string; version: number }> & { latest?: { strokes: DrawingStroke[]; version: number } }> {
  const auth = await authorize(P.gynecologyEdit)
  if (auth.error) return auth.error
  const parsed = z
    .object({
      patientId: id,
      visitId: id,
      templateKey: z.string().regex(/^[a-z0-9_]+$/),
      strokes: z.array(strokeSchema).max(2000),
      width: z.number().int().min(100).max(4000),
      height: z.number().int().min(100).max(4000),
    })
    .safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  const supabase = await createClient({ auditReason: input.reason })

  if (input.expectedVersion == null) {
    const { data, error } = await supabase
      .from("ultrasound_annotations")
      .upsert(
        { patient_id: v.patientId, visit_id: v.visitId, template_key: v.templateKey, strokes: v.strokes, width: v.width, height: v.height },
        { onConflict: "visit_id,template_key", ignoreDuplicates: true },
      )
      .select("id, version")
      .maybeSingle()
    if (error) return dbFail("saveAnnotation insert", error)
    if (data) return ok(data)
  } else {
    const { data, error } = await supabase
      .from("ultrasound_annotations")
      .update({ strokes: v.strokes, width: v.width, height: v.height })
      .eq("visit_id", v.visitId)
      .eq("template_key", v.templateKey)
      .eq("version", input.expectedVersion)
      .select("id, version")
      .maybeSingle()
    if (error) return dbFail("saveAnnotation update", error)
    if (data) return ok(data)
  }
  const { data: current } = await supabase
    .from("ultrasound_annotations")
    .select("strokes, version")
    .eq("visit_id", v.visitId)
    .eq("template_key", v.templateKey)
    .maybeSingle()
  if (!current) return fail("forbidden")
  return { ok: false, error: { code: "conflict" }, latest: current as { strokes: DrawingStroke[]; version: number } }
}

// ---------------------------------------------------------------------
// IVF consent record (selections from the consent form)
// ---------------------------------------------------------------------
export async function createIvfConsent(input: {
  patientId: string
  fertilityCaseId: string
  visitId?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.fertilityEdit)
  if (auth.error) return auth.error
  const parsed = z.object({ patientId: id, fertilityCaseId: id, visitId: id.nullable().optional() }).safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("ivf_consents")
    .insert({
      patient_id: parsed.data.patientId,
      fertility_case_id: parsed.data.fertilityCaseId,
      visit_id: parsed.data.visitId ?? null,
    })
    .select("id")
    .single()
  if (error) return dbFail("createIvfConsent", error)
  return ok(data)
}
