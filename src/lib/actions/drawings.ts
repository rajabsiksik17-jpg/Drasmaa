"use server"

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { limit } from "@/lib/security/rate-limit"
import type { DrawingShape } from "@/types/db"

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
}
const MAX_IMAGE = 25 * 1024 * 1024
const contexts = z.enum(["gynecology", "fertility", "pregnancy", "other"])

const prepareSchema = z.object({
  visitId: z.uuid(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(100),
  size: z.number().int().positive(),
})

const EXT_BY_NAME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }
const UPLOAD_PATH = /^[0-9a-f-]{36}\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/

/**
 * Ultrasound upload, step 1: validate (type by MIME *and* extension, size)
 * and issue a one-time signed upload URL to the private bucket. The browser
 * then uploads directly to Storage with real progress and can cancel; large
 * phone photos never pass through a Server Action body.
 */
export async function prepareUltrasoundUpload(input: z.input<typeof prepareSchema>): Promise<ActionResult<{ path: string; signedUrl: string }>> {
  const auth = await authorize(P.drawingsCreate)
  if (auth.error) return auth.error
  const parsed = prepareSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  const ext = v.fileName.toLowerCase().split(".").pop() ?? ""
  const kind = IMAGE_TYPES[v.mimeType]
  if (!kind || EXT_BY_NAME[ext] !== v.mimeType) return fail("fileType")
  if (v.size > MAX_IMAGE) return fail("fileTooLarge")
  if (!(await limit("uploadPerUser", auth.session.userId))) return fail("rateLimited")
  const supabase = await createClient()
  const { data: visit } = await supabase.from("visits").select("patient_id, status").eq("id", v.visitId).maybeSingle()
  if (!visit) return fail("notFound")
  if (visit.status === "cancelled") return fail("visitCancelled")
  const path = `${visit.patient_id}/images/${crypto.randomUUID()}.${kind.ext}`
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    console.error(`[drawings] signed upload URL failed: ${error?.message ?? "unknown"}`)
    return fail("uploadFailed")
  }
  return ok({ path, signedUrl: data.signedUrl })
}

const finalizeSchema = z.object({
  visitId: z.uuid(),
  path: z.string().regex(UPLOAD_PATH),
  fileName: z.string().trim().min(1).max(255),
  context: contexts,
  width: z.number().int().min(16).max(12000),
  height: z.number().int().min(16).max(12000),
  title: z.string().trim().max(200).nullable().optional(),
})

/**
 * Step 2: verify what really arrived in Storage (content signature, size,
 * SHA-256) and register image + drawing. Anything wrong removes the object,
 * so the database never points at a missing or fake file.
 */
export async function finalizeUltrasoundUpload(input: z.input<typeof finalizeSchema>): Promise<ActionResult<{ drawingId: string }>> {
  const auth = await authorize(P.drawingsCreate)
  if (auth.error) return auth.error
  const parsed = finalizeSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  const supabase = await createClient()
  const { data: visit } = await supabase.from("visits").select("patient_id, status").eq("id", v.visitId).maybeSingle()
  if (!visit) return fail("notFound")
  if (!v.path.startsWith(`${visit.patient_id}/images/`)) return fail("validation")
  const discard = async () => {
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([v.path])
    if (error) console.error(`[drawings] orphan cleanup failed: ${error.message}`)
  }
  const { data: blob, error: dlError } = await supabase.storage.from(DOCUMENTS_BUCKET).download(v.path)
  if (dlError || !blob) {
    console.error(`[drawings] uploaded object not readable: ${dlError?.message ?? "missing"}`)
    return fail("uploadFailed")
  }
  const bytes = Buffer.from(await blob.arrayBuffer())
  const ext = v.path.split(".").pop()!
  const mime = Object.entries(IMAGE_TYPES).find(([, k]) => k.ext === ext)![0]
  if (!IMAGE_TYPES[mime].magic(bytes)) {
    await discard()
    return fail("fileType")
  }
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE) {
    await discard()
    return fail("fileTooLarge")
  }
  const { data: image, error } = await supabase
    .from("medical_images")
    .insert({
      patient_id: visit.patient_id,
      visit_id: v.visitId,
      context: v.context,
      storage_path: v.path,
      mime_type: mime,
      size_bytes: bytes.length,
      width: v.width,
      height: v.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      title: v.title || null,
      original_filename: v.fileName.slice(0, 255),
    })
    .select("id")
    .single()
  if (error) {
    await discard()
    return dbFail("finalizeUltrasoundUpload", error)
  }
  const { data: drawing, error: dError } = await supabase
    .from("medical_drawings")
    .insert({
      patient_id: visit.patient_id,
      visit_id: v.visitId,
      image_id: image.id,
      context: v.context,
      title: v.title || null,
      canvas_width: v.width,
      canvas_height: v.height,
    })
    .select("id")
    .single()
  if (dError) return dbFail("createDrawing", dError)
  revalidatePath(`/patients/${visit.patient_id}/visits/${v.visitId}`)
  return ok({ drawingId: drawing.id })
}

/** Cancelled / failed upload: remove the orphan object (never a registered image). */
export async function discardUltrasoundUpload(path: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.drawingsCreate)
  if (auth.error) return auth.error
  if (!UPLOAD_PATH.test(path)) return fail("validation")
  const supabase = await createClient()
  const { data: registered } = await supabase.from("medical_images").select("id").eq("storage_path", path).maybeSingle()
  if (registered) return fail("forbidden")
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
  if (error) console.error(`[drawings] discard failed: ${error.message}`)
  return ok(undefined)
}

/** A drawing on a clinic diagram (e.g. the pelvis template) instead of a photo. */
export async function createTemplateDrawing(input: { visitId: string; templateKey: string; context: string }): Promise<ActionResult<{ drawingId: string }>> {
  const auth = await authorize(P.drawingsCreate)
  if (auth.error) return auth.error
  const ctx = contexts.safeParse(input.context)
  if (!z.uuid().safeParse(input.visitId).success || !/^[a-z0-9_]+$/.test(input.templateKey) || !ctx.success) return fail("validation")
  const supabase = await createClient()
  const { data: visit } = await supabase.from("visits").select("patient_id, status").eq("id", input.visitId).maybeSingle()
  if (!visit) return fail("notFound")
  if (visit.status === "cancelled") return fail("visitCancelled")
  const { data, error } = await supabase
    .from("medical_drawings")
    .insert({ patient_id: visit.patient_id, visit_id: input.visitId, template_key: input.templateKey, context: ctx.data, canvas_width: 1000, canvas_height: 700 })
    .select("id")
    .single()
  if (error) return dbFail("createTemplateDrawing", error)
  revalidatePath(`/patients/${visit.patient_id}/visits/${input.visitId}`)
  return ok({ drawingId: data.id })
}

const point = z.number().finite().min(-20000).max(40000)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const shapeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().max(40), type: z.enum(["pen", "marker", "highlight"]), points: z.array(point).min(2).max(20000), color, size: z.number().min(1).max(80) }),
  z.object({ id: z.string().max(40), type: z.enum(["line", "arrow"]), points: z.tuple([point, point, point, point]), color, size: z.number().min(1).max(80) }),
  z.object({ id: z.string().max(40), type: z.enum(["circle", "rect"]), x: point, y: point, w: point, h: point, color, size: z.number().min(1).max(80), rotation: z.number().min(-360).max(360).optional() }),
  z.object({ id: z.string().max(40), type: z.literal("text"), x: point, y: point, text: z.string().min(1).max(300), color, size: z.number().min(8).max(400), rotation: z.number().min(-360).max(360).optional() }),
])

const saveSchema = z.object({
  id: z.uuid(),
  expectedVersion: z.number().int(),
  shapes: z.array(shapeSchema).max(2000),
  notes: z.string().max(4000).nullable(),
  title: z.string().max(200).nullable().optional(),
  reason: z.string().max(300).nullable().optional(),
})

/** Saves the annotation layer (the original image is never touched). */
export async function saveDrawing(input: z.input<typeof saveSchema>): Promise<ActionResult<{ version: number }>> {
  const auth = await authorize(P.drawingsCreate, P.drawingsEdit)
  if (auth.error) return auth.error
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  const supabase = await createClient({ auditReason: v.reason })
  const { data, error } = await supabase
    .from("medical_drawings")
    .update({ shapes: v.shapes as DrawingShape[], notes: v.notes?.trim() || null, ...(v.title !== undefined ? { title: v.title?.trim() || null } : {}) })
    .eq("id", v.id)
    .eq("version", v.expectedVersion)
    .select("version")
    .maybeSingle()
  if (error) return dbFail("saveDrawing", error)
  if (!data) return fail("conflict")
  return ok({ version: data.version })
}

/** Rendered preview (PNG) of image + drawing, used for thumbnails. */
export async function saveDrawingPreview(input: { id: string; dataUrl: string }): Promise<ActionResult<{ version: number }>> {
  const auth = await authorize(P.drawingsCreate, P.drawingsEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(input.id).success) return fail("validation")
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl)
  if (!m || m[1].length > 8_000_000) return fail("fileType")
  const bytes = Buffer.from(m[1], "base64")
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50)) return fail("fileType")
  const supabase = await createClient()
  const { data: d } = await supabase.from("medical_drawings").select("patient_id, preview_path, version").eq("id", input.id).maybeSingle()
  if (!d) return fail("notFound")
  const path = `${d.patient_id}/drawings/${crypto.randomUUID()}.png`
  const { error: upError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: "image/png" })
  if (upError) return fail("uploadFailed")
  // Preview is metadata only: written without bumping history (no shapes change).
  const { data: saved, error } = await supabase.from("medical_drawings").update({ preview_path: path }).eq("id", input.id).select("version").single()
  if (error) return dbFail("saveDrawingPreview", error)
  if (d.preview_path) {
    const { error: rmError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([d.preview_path])
    if (rmError) console.error(`[drawings] old preview cleanup failed: ${rmError.message}`)
  }
  return ok({ version: saved.version })
}

/** Short-lived URL of the original image for the editor (RLS checked). */
export async function getImageUrl(imageId: string): Promise<ActionResult<{ url: string }>> {
  const auth = await authorize(P.drawingsView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(imageId).success) return fail("validation")
  const supabase = await createClient()
  const { data: img } = await supabase.from("medical_images").select("storage_path").eq("id", imageId).maybeSingle()
  if (!img) return fail("notFound")
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(img.storage_path, 600)
  if (error || !data) return fail("forbidden")
  return ok({ url: data.signedUrl })
}

/** Delete = archive with a reason (who/when kept); the image and history stay. */
export async function archiveDrawing(id: string, reason: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.drawingsCreate, P.drawingsEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success || reason.trim().length < 3) return fail("validation", ["reason"])
  const supabase = await createClient({ auditReason: reason })
  const { data, error } = await supabase.from("medical_drawings").update({ status: "archived" }).eq("id", id).select("patient_id, visit_id").maybeSingle()
  if (error) return dbFail("archiveDrawing", error)
  if (!data) return fail("notFound")
  revalidatePath(`/patients/${data.patient_id}/visits/${data.visit_id}`)
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

/** Restore a deleted (archived) drawing — doctors/admins with drawings.edit. */
export async function restoreDrawing(id: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.drawingsEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient({ auditReason: "Restored" })
  const { data, error } = await supabase.from("medical_drawings").update({ status: "active" }).eq("id", id).select("patient_id, visit_id").maybeSingle()
  if (error) return dbFail("restoreDrawing", error)
  if (!data) return fail("notFound")
  revalidatePath(`/patients/${data.patient_id}/visits/${data.visit_id}`)
  revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

export async function listDrawingVersions(id: string): Promise<ActionResult<{ id: string; version_no: number; created_at: string; reason: string | null; shapes: DrawingShape[]; notes: string | null }[]>> {
  const auth = await authorize(P.drawingsView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("medical_drawing_versions")
    .select("id, version_no, created_at, reason, shapes, notes")
    .eq("drawing_id", id)
    .order("version_no", { ascending: false })
  if (error) return dbFail("listDrawingVersions", error)
  return ok((data ?? []) as never)
}
