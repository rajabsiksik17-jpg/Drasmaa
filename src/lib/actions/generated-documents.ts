"use server"

import { createHash, randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { TZDate } from "@date-fns/tz"
import { format } from "date-fns"
import { z } from "zod"
import { authorize, hasPermission, type Session } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { CLINIC_TZ } from "@/lib/dates"
import { limit } from "@/lib/security/rate-limit"
import { isServiceRoleConfigured } from "@/lib/security/events"
import { DOCUMENTS, DOCUMENT_TYPES, SUMMARY_SECTIONS, buildFileName, type DocumentType, type SourceEntity } from "@/lib/documents/registry"
import { internalOrigin, renderPdf } from "@/lib/pdf/render"
import { rendererCookies } from "@/lib/pdf/session"

type Supa = Awaited<ReturnType<typeof createClient>>

const generateSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  entityId: z.uuid(),
  language: z.enum(["ar", "en"]),
  sections: z.array(z.string().regex(/^[a-z_]+$/)).max(30).optional(),
  codes: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(60).optional(),
})
export type GenerateInput = z.input<typeof generateSchema>

interface Resolved {
  /** null only for standalone medical reports (person not registered). */
  patientId: string | null
  patientName: string
  patientCode: string
  links: {
    visit_id?: string
    pregnancy_case_id?: string
    fertility_case_id?: string
    cycle_id?: string
    appointment_id?: string
    report_id?: string
    prescription_id?: string
    invoice_id?: string
    payment_id?: string
    drawing_id?: string
  }
}

const SOURCE_TABLES: Record<Exclude<SourceEntity, "patient">, string> = {
  visit: "visits",
  pregnancy_case: "pregnancy_cases",
  fertility_case: "fertility_cases",
  cycle: "fertility_cycles",
  appointment: "appointments",
  consent: "ivf_consents",
  prescription: "prescriptions",
  report: "medical_reports",
  invoice: "invoices",
  payment: "payments",
  drawing: "medical_drawings",
}

/**
 * The source record is looked up with the user's own RLS-bound client, so
 * the patient is derived from data the user is allowed to see — never from
 * an id supplied by the browser.
 */
async function resolveSource(supabase: Supa, type: DocumentType, entityId: string): Promise<Resolved | null> {
  const source = DOCUMENTS[type].source
  const links: Resolved["links"] = {}
  let patientId: string | null = null
  if (source === "patient") patientId = entityId
  else {
    const select = source === "report" ? "patient_id, subject_name, report_number, status" : source === "invoice" ? "patient_id, status" : "patient_id"
    const { data } = await supabase.from(SOURCE_TABLES[source]).select(select).eq("id", entityId).maybeSingle()
    if (!data) return null
    const row = data as unknown as { patient_id: string | null; subject_name?: string; report_number?: string; status?: string }
    patientId = row.patient_id
    const key = ({ visit: "visit_id", pregnancy_case: "pregnancy_case_id", fertility_case: "fertility_case_id", cycle: "cycle_id",
      appointment: "appointment_id", report: "report_id", prescription: "prescription_id", invoice: "invoice_id", payment: "payment_id",
      drawing: "drawing_id" } as Record<string, keyof Resolved["links"]>)[source]
    if (key) links[key] = entityId
    if (source === "report") {
      if (row.status === "void") return null
      if (!patientId) return { patientId: null, patientName: row.subject_name ?? "Report", patientCode: row.report_number ?? "", links }
    }
    if (source === "invoice" && type === "insurance_claim" && row.status === "void") return null
  }
  if (!patientId) return null
  const { data: patient } = await supabase.from("patients").select("id, full_name, patient_code").eq("id", patientId).maybeSingle()
  if (!patient) return null
  if (type === "gynecology_visit") {
    const { data: v } = await supabase.from("visits").select("visit_type").eq("id", entityId).maybeSingle()
    if (v?.visit_type !== "gynecology") return null
  }
  return { patientId, patientName: patient.full_name, patientCode: patient.patient_code, links }
}

function allowedSections(session: Session, requested?: string[]) {
  const allowed = SUMMARY_SECTIONS.filter((s) => hasPermission(session, s.permission)).map((s) => s.key as string)
  const list = requested?.length ? requested : SUMMARY_SECTIONS.filter((s) => s.default).map((s) => s.key as string)
  return list.filter((s) => allowed.includes(s))
}

/** Query string for the render route (non-sensitive options only). */
function renderQuery(input: z.infer<typeof generateSchema>, session: Session, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ lang: input.language, ...extra })
  if (input.type === "patient_summary") q.set("sections", allowedSections(session, input.sections).join(","))
  if (input.type === "investigations" && input.codes?.length) q.set("codes", input.codes.join(","))
  if (input.type === "gynecology_visit") q.set("only", "gynecology")
  return q
}

/** Preview URL (same view the PDF is printed from). */
export async function documentPreviewUrl(input: GenerateInput): Promise<ActionResult<{ url: string }>> {
  const auth = await authorize(P.documentsGenerate)
  if (auth.error) return auth.error
  const parsed = generateSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const cfg = DOCUMENTS[parsed.data.type]
  if (!cfg.permissions.every((p) => hasPermission(auth.session, p))) return fail("forbidden")
  const q = renderQuery(parsed.data, auth.session, { preview: "1" })
  return ok({ url: `${cfg.route(parsed.data.entityId)}?${q}` })
}

export interface GeneratedDocument {
  id: string
  file_name: string
  size_bytes: number
  document_type: DocumentType
  language: "ar" | "en"
  generated_at: string
  version_no: number
}

export async function generateDocument(input: GenerateInput): Promise<ActionResult<GeneratedDocument>> {
  const auth = await authorize(P.documentsGenerate)
  if (auth.error) return auth.error
  const parsed = generateSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  const cfg = DOCUMENTS[v.type]
  if (!cfg.permissions.every((p) => hasPermission(auth.session, p))) return fail("forbidden")
  if (!(await limit("pdfPerUser", auth.session.userId))) return fail("rateLimited")

  const supabase = await createClient()
  const src = await resolveSource(supabase, v.type, v.entityId)
  if (!src) return fail("notFound")

  const { data: template } = await supabase.from("document_templates").select("*").eq("document_type", v.type).single()
  const orientation = (template?.orientation as "portrait" | "landscape" | undefined) ?? cfg.orientation
  const now = new TZDate(new Date(), CLINIC_TZ)
  const fileName = buildFileName(src.patientName, v.type, { date: format(now, "yyyy-MM-dd"), time: format(now, "HH:mm") })
  const ref = randomUUID()

  const cookieJar = await rendererCookies(v.language)
  if (!cookieJar) return fail("unauthenticated")
  const q = renderQuery(v, auth.session, { pdf: "1" })
  let pdf: Buffer
  try {
    pdf = await renderPdf({
      url: `${internalOrigin()}${cfg.route(v.entityId)}?${q}`,
      cookies: cookieJar,
      orientation,
      margins: {
        top: template?.margin_top_mm ?? 12,
        right: template?.margin_right_mm ?? 10,
        bottom: Math.max(template?.margin_bottom_mm ?? 14, 12),
        left: template?.margin_left_mm ?? 10,
      },
      footer: `${src.patientCode} · ${format(now, "dd/MM/yyyy HH:mm")} · Ref ${ref.slice(0, 8).toUpperCase()}`,
    })
  } catch (e) {
    console.error(`[pdf] ${v.type} render failed: ${(e as Error).message}`)
    return fail("pdfFailed")
  }

  const folder = src.patientId ? `${src.patientId}/generated` : "standalone/generated"
  const storagePath = `${folder}/${format(now, "yyyy")}/${format(now, "MM")}/${ref}.pdf`
  const { error: upError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: false,
  })
  if (upError) {
    console.error(`[pdf] upload failed: ${upError.message}`)
    return fail("forbidden")
  }

  const { data: doc, error } = await supabase
    .from("generated_documents")
    .insert({
      id: ref,
      patient_id: src.patientId,
      document_type: v.type,
      title: template?.name_en ?? v.type,
      file_name: fileName,
      storage_path: storagePath,
      size_bytes: pdf.length,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      language: v.language,
      orientation,
      source_entity_type: cfg.source,
      source_entity_id: v.entityId,
      ...src.links,
      options: {
        ...(v.type === "patient_summary" ? { sections: allowedSections(auth.session, v.sections) } : {}),
        ...(v.type === "investigations" && v.codes?.length ? { codes: v.codes } : {}),
      },
      template_version: template?.version ?? null,
      generated_by: auth.session.userId,
    })
    .select("id, file_name, size_bytes, document_type, language, generated_at, version_no")
    .single()
  if (error) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath])
    return dbFail("generateDocument", error)
  }
  await supabase.rpc("log_document_access", { p_generated: doc.id, p_document: null, p_action: "generated" })
  if (src.patientId) revalidatePath(`/patients/${src.patientId}`)
  if (src.links.report_id) revalidatePath(`/reports/${src.links.report_id}`)
  return ok(doc as GeneratedDocument)
}

const shareActions = z.enum(["printed", "downloaded", "shared_native", "previewed"])

export async function logDocumentShare(id: string, action: z.input<typeof shareActions>): Promise<ActionResult<void>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success || !shareActions.safeParse(action).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.rpc("log_document_access", {
    p_generated: id,
    p_document: null,
    p_action: action,
    p_channel: action === "shared_native" ? "device" : null,
  })
  if (error) return dbFail("logDocumentShare", error)
  return ok(undefined)
}

/** Removes the exported file; the snapshot's metadata and audit history stay. */
export async function deleteGeneratedDocument(id: string, reason: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.documentsDelete)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  if (!isServiceRoleConfigured()) return fail("serviceKeyMissing")
  const supabase = await createClient({ auditReason: reason })
  const { data, error } = await supabase
    .from("generated_documents")
    .update({ status: "deleted", delete_reason: reason.trim().slice(0, 300) || null })
    .eq("id", id)
    .eq("status", "generated")
    .select("patient_id, storage_path")
    .maybeSingle()
  if (error) return dbFail("deleteGeneratedDocument", error)
  if (!data) return fail("notFound")
  await createAdminClient().storage.from(DOCUMENTS_BUCKET).remove([data.storage_path])
  await createAdminClient().from("document_access_logs").insert({
    generated_document_id: id,
    patient_id: data.patient_id,
    action: "deleted",
    actor_id: auth.session.userId,
  })
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

export interface GeneratedDocumentRow {
  id: string
  document_type: DocumentType
  title: string
  file_name: string
  size_bytes: number
  language: "ar" | "en"
  orientation: string
  version_no: number
  status: "generated" | "deleted" | "expired"
  source_entity_type: string | null
  generated_at: string
  expires_at: string | null
  deleted_at: string | null
  generator: { full_name: string } | null
}

export async function listGeneratedDocuments(patientId: string): Promise<ActionResult<GeneratedDocumentRow[]>> {
  const auth = await authorize(P.patientsView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("generated_documents")
    .select(
      "id, document_type, title, file_name, size_bytes, language, orientation, version_no, status, source_entity_type, generated_at, expires_at, deleted_at, generator:profiles!generated_documents_generated_by_fkey(full_name)",
    )
    .eq("patient_id", patientId)
    .order("generated_at", { ascending: false })
    .limit(100)
  if (error) return dbFail("listGeneratedDocuments", error)
  return ok((data ?? []) as unknown as GeneratedDocumentRow[])
}

export interface ShareTargets {
  patientId: string
  latestVisit: { id: string; type: string } | null
  pregnancyCase: string | null
  fertilityCase: string | null
  cycle: string | null
  appointment: string | null
  hasInvestigations: boolean
}

/** What the patient "Share" menu can offer to this user. */
export async function getShareTargets(patientId: string): Promise<ActionResult<ShareTargets>> {
  const auth = await authorize(P.documentsGenerate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const can = (c: (typeof P)[keyof typeof P]) => hasPermission(auth.session, c)
  const none = Promise.resolve({ data: null })
  const [visit, preg, fert, cycle, appt, inv] = await Promise.all([
    can(P.visitsView) ? supabase.from("visits").select("id, visit_type").eq("patient_id", patientId).neq("status", "cancelled").order("visit_date", { ascending: false }).order("started_at", { ascending: false }).limit(1).maybeSingle() : none,
    can(P.pregnancyView) ? supabase.from("pregnancy_cases").select("id").eq("patient_id", patientId).order("opened_at", { ascending: false }).limit(1).maybeSingle() : none,
    can(P.fertilityView) ? supabase.from("fertility_cases").select("id").eq("patient_id", patientId).order("opened_at", { ascending: false }).limit(1).maybeSingle() : none,
    can(P.oiView) ? supabase.from("fertility_cycles").select("id").eq("patient_id", patientId).order("started_at", { ascending: false }).limit(1).maybeSingle() : none,
    can(P.appointmentsView)
      ? supabase.from("appointments").select("id").eq("patient_id", patientId).in("status", ["scheduled", "checked_in"]).gte("scheduled_at", new Date(Date.now() - 86400_000).toISOString()).order("scheduled_at").limit(1).maybeSingle()
      : none,
    can(P.investigationsView) ? supabase.from("investigation_results").select("id").eq("patient_id", patientId).limit(1).maybeSingle() : none,
  ])
  const v = visit.data as { id: string; visit_type: string } | null
  return ok({
    patientId,
    latestVisit: v ? { id: v.id, type: v.visit_type } : null,
    pregnancyCase: (preg.data as { id: string } | null)?.id ?? null,
    fertilityCase: (fert.data as { id: string } | null)?.id ?? null,
    cycle: (cycle.data as { id: string } | null)?.id ?? null,
    appointment: (appt.data as { id: string } | null)?.id ?? null,
    hasInvestigations: !!inv.data,
  })
}

/** Investigation types that actually have results for this patient. */
export async function listInvestigationCodes(patientId: string): Promise<ActionResult<{ code: string; count: number }[]>> {
  const auth = await authorize(P.investigationsView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase.from("investigation_results").select("type_code").eq("patient_id", patientId).limit(2000)
  if (error) return dbFail("listInvestigationCodes", error)
  const counts = new Map<string, number>()
  for (const r of data ?? []) counts.set(r.type_code, (counts.get(r.type_code) ?? 0) + 1)
  return ok([...counts].map(([code, count]) => ({ code, count })))
}
