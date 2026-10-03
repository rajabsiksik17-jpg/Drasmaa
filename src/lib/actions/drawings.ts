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

/**
 * Upload an ultrasound image into the visit and open a drawing on it.
 * The file is checked by its content (magic bytes), stored privately under
 * an unpredictable name, and never modified afterwards.
 */
export async function uploadUltrasoundImage(formData: FormData): Promise<ActionResult<{ drawingId: string }>> {
  const auth = await authorize(P.drawingsCreate)
  if (auth.error) return auth.error
  const visitId = String(formData.get("visitId") ?? "")
  const context = contexts.safeParse(formData.get("context") ?? "gynecology")
  const width = Number(formData.get("width"))
  const height = Number(formData.get("height"))
  const title = String(formData.get("title") ?? "").trim().slice(0, 200) || null
  const file = formData.get("file")
  if (!z.uuid().safeParse(visitId).success || !context.success || !(file instanceof File)) return fail("validation")
  if (!(width >= 16 && width <= 12000 && height >= 16 && height <= 12000)) return fail("fileType")
  const kind = IMAGE_TYPES[file.type]
  if (!kind) return fail("fileType")
  if (file.size <= 0 || file.size > MAX_IMAGE) return fail("fileTooLarge")
  if (!(await limit("uploadPerUser", auth.session.userId))) return fail("rateLimited")
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!kind.magic(bytes)) return fail("fileType")

  const supabase = await createClient()
  const { data: visit } = await supabase.from("visits").select("patient_id, status").eq("id", visitId).maybeSingle()
  if (!visit) return fail("notFound")
  if (visit.status === "cancelled") return fail("visitCancelled")
  const path = `${visit.patient_id}/images/${crypto.randomUUID()}.${kind.ext}`
  const { error: upError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false })
  if (upError) {
    console.error(`[drawings] upload failed: ${upError.message}`)
    return fail("uploadFailed")
  }
  const { data: image, error } = await supabase
    .from("medical_images")
    .insert({
      patient_id: visit.patient_id,
      visit_id: visitId,
      context: context.data,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      width: Math.round(width),
      height: Math.round(height),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      title,
    })
    .select("id")
    .single()
  if (error) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
    return dbFail("uploadUltrasoundImage", error)
  }
  const { data: drawing, error: dError } = await supabase
    .from("medical_drawings")
    .insert({
      patient_id: visit.patient_id,
      visit_id: visitId,
      image_id: image.id,
      context: context.data,
      title,
      canvas_width: Math.round(width),
      canvas_height: Math.round(height),
    })
    .select("id")
    .single()
  if (dError) return dbFail("createDrawing", dError)
  revalidatePath(`/patients/${visit.patient_id}/visits/${visitId}`)
  return ok({ drawingId: drawing.id })
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
  z.object({ id: z.string().max(40), type: z.enum(["circle", "rect"]), x: point, y: point, w: point, h: point, color, size: z.number().min(1).max(80) }),
  z.object({ id: z.string().max(40), type: z.literal("text"), x: point, y: point, text: z.string().min(1).max(300), color, size: z.number().min(8).max(200) }),
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
  if (d.preview_path) await supabase.storage.from(DOCUMENTS_BUCKET).remove([d.preview_path]).catch(() => {})
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

export async function archiveDrawing(id: string, reason: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.drawingsEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success || reason.trim().length < 3) return fail("validation", ["reason"])
  const supabase = await createClient({ auditReason: reason })
  const { data, error } = await supabase.from("medical_drawings").update({ status: "archived" }).eq("id", id).select("patient_id, visit_id").maybeSingle()
  if (error) return dbFail("archiveDrawing", error)
  if (!data) return fail("notFound")
  revalidatePath(`/patients/${data.patient_id}/visits/${data.visit_id}`)
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
