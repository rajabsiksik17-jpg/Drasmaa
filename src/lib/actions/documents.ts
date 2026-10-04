"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { checkFile, mimeForFile } from "@/lib/storage/files"
import { DOCUMENT_CATEGORIES } from "@/types/db"
import { limit } from "@/lib/security/rate-limit"

const linkSchema = z.object({
  patientId: z.uuid(),
  visitId: z.uuid().nullable().optional(),
  fertilityCaseId: z.uuid().nullable().optional(),
  pregnancyCaseId: z.uuid().nullable().optional(),
  cycleId: z.uuid().nullable().optional(),
  investigationId: z.uuid().nullable().optional(),
  category: z.enum(DOCUMENT_CATEGORIES),
})

const metaSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
})

const fileSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().max(100),
  size: z.number().int().positive(),
})

async function maxUploadMb(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("clinic_settings").select("max_upload_mb").eq("id", 1).maybeSingle()
  return data?.max_upload_mb ?? 20
}

/** Step 1: validate and issue a one-time signed upload URL (private bucket). */
export async function prepareUpload(
  input: z.input<typeof linkSchema> & z.input<typeof fileSchema>,
): Promise<ActionResult<{ path: string; signedUrl: string; token: string }>> {
  const auth = await authorize(P.documentsUpload)
  if (auth.error) return auth.error
  const link = linkSchema.safeParse(input)
  const file = fileSchema.safeParse(input)
  if (!link.success || !file.success) return fail("validation")
  if (!(await limit("uploadPerUser", auth.session.userId))) return fail("rateLimited")

  const supabase = await createClient()
  const check = checkFile(
    { name: file.data.fileName, type: file.data.mimeType, size: file.data.size },
    await maxUploadMb(supabase),
  )
  if (!check.ok) return fail(check.code)

  const path = `${link.data.patientId}/${crypto.randomUUID()}.${check.ext}`
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    console.error(`[storage] prepareUpload failed: ${error?.message ?? "unknown"}`)
    return fail("forbidden")
  }
  return ok({ path, signedUrl: data.signedUrl, token: data.token })
}

/**
 * Step 2: after the browser uploaded the bytes, verify the object exists and
 * register the document. If registration fails, the orphaned object is
 * removed so the database never claims a file that is not there (and vice
 * versa).
 */
export async function finalizeUpload(
  input: z.input<typeof linkSchema> & z.input<typeof fileSchema> & z.input<typeof metaSchema> & { path: string },
): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.documentsUpload)
  if (auth.error) return auth.error
  const link = linkSchema.safeParse(input)
  const file = fileSchema.safeParse(input)
  const meta = metaSchema.safeParse(input)
  if (!link.success || !file.success || !meta.success) return fail("validation")
  if (!input.path.startsWith(`${link.data.patientId}/`) || input.path.includes("..")) return fail("validation")

  const supabase = await createClient()
  const check = checkFile({ name: file.data.fileName, type: file.data.mimeType, size: file.data.size }, await maxUploadMb(supabase))
  if (!check.ok) return fail(check.code)

  const [folder, objectName] = input.path.split("/")
  const { data: listed, error: listError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .list(folder, { search: objectName, limit: 1 })
  if (listError || !listed?.some((o) => o.name === objectName)) return fail("uploadFailed")

  const { data, error } = await supabase
    .from("documents")
    .insert({
      patient_id: link.data.patientId,
      visit_id: link.data.visitId ?? null,
      fertility_case_id: link.data.fertilityCaseId ?? null,
      pregnancy_case_id: link.data.pregnancyCaseId ?? null,
      cycle_id: link.data.cycleId ?? null,
      investigation_id: link.data.investigationId ?? null,
      category: link.data.category,
      title: meta.data.title || null,
      notes: meta.data.notes || null,
      document_date: meta.data.documentDate ?? null,
      tags: meta.data.tags ?? [],
      file_name: file.data.fileName,
      mime_type: mimeForFile({ name: file.data.fileName, type: file.data.mimeType }),
      size_bytes: file.data.size,
      storage_path: input.path,
      uploaded_by: auth.session.userId,
    })
    .select("id")
    .single()

  if (error) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([input.path])
    return dbFail("finalizeUpload", error)
  }
  revalidatePath(`/patients/${link.data.patientId}`)
  return ok(data)
}

/** Abandoned upload (e.g. user cancelled): remove the orphan object. */
export async function discardUpload(path: string): Promise<ActionResult> {
  const auth = await authorize(P.documentsUpload)
  if (auth.error) return auth.error
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z]+$/.test(path)) return fail("validation")
  const supabase = await createClient()
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
  return ok(undefined)
}

/** Short-lived signed URL; the bucket is private and never public. */
export async function getDocumentUrl(documentId: string, download = false): Promise<ActionResult<{ url: string }>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(documentId).success) return fail("validation")
  const supabase = await createClient()
  const { data: doc, error } = await supabase
    .from("documents")
    .select("storage_path, file_name")
    .eq("id", documentId)
    .maybeSingle()
  if (error) return dbFail("getDocumentUrl", error)
  if (!doc) return fail("notFound")
  const { data, error: signError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, 120, download ? { download: doc.file_name } : undefined)
  if (signError || !data) return fail("forbidden")
  // Medical document access is audited (viewed / downloaded).
  await supabase.rpc("log_document_access", {
    p_generated: null,
    p_document: documentId,
    p_action: download ? "downloaded" : "viewed",
  })
  return ok({ url: data.signedUrl })
}

export async function setDocumentArchived(documentId: string, archived: boolean, reason?: string): Promise<ActionResult> {
  const auth = await authorize(P.documentsArchive)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(documentId).success) return fail("validation")
  const supabase = await createClient({ auditReason: reason })
  const { data, error } = await supabase
    .from("documents")
    .update({ status: archived ? "archived" : "active" })
    .eq("id", documentId)
    .select("patient_id")
    .maybeSingle()
  if (error) return dbFail("setDocumentArchived", error)
  if (!data) return fail("notFound")
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

export async function linkConsentDocument(consentId: string, documentId: string): Promise<ActionResult> {
  const auth = await authorize(P.fertilityEdit)
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { error } = await supabase
    .from("ivf_consents")
    .update({ document_id: documentId, status: "signed" })
    .eq("id", consentId)
  if (error) return dbFail("linkConsentDocument", error)
  return ok(undefined)
}

const editSchema = metaSchema.extend({
  id: z.uuid(),
  category: z.enum(DOCUMENT_CATEGORIES),
  // Re-link between patient level and one of the patient's visits.
  visitId: z.uuid().nullable().optional(),
})

/** Rename / edit metadata (display name, category, description, date, tags, level). The file never changes. */
export async function updateDocumentMeta(input: z.input<typeof editSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.documentsUpload, P.documentsArchive)
  if (auth.error) return auth.error
  const parsed = editSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("documents")
    .update({
      title: v.title || null,
      notes: v.notes || null,
      category: v.category,
      document_date: v.documentDate ?? null,
      tags: v.tags ?? [],
      ...(v.visitId !== undefined ? { visit_id: v.visitId } : {}),
    })
    .eq("id", v.id)
    .select("patient_id")
    .maybeSingle()
  if (error) return dbFail("updateDocumentMeta", error)
  if (!data) return fail("forbidden")
  revalidatePath(`/patients/${data.patient_id}`, "layout")
  return ok(undefined)
}
