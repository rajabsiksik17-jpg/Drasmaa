import "server-only"
import { createClient } from "@/lib/supabase/server"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"
import { logDbError } from "@/lib/errors"
import type { MedicalDrawing } from "@/types/db"

export interface LoadedDrawing {
  drawing: MedicalDrawing
  background: string | null
}

type DrawingFilter = { visitId?: string; drawingId?: string; patientId?: string; status?: "active" | "archived" }

/**
 * Drawings with a short-lived URL for the original image (RLS checked).
 * Diagram drawings use the static clinic template. Failures are raised to
 * the page's error boundary instead of looking like "no drawings".
 */
export async function loadDrawings(filter: DrawingFilter, ttlSeconds = 900): Promise<LoadedDrawing[]> {
  const supabase = await createClient()
  let q = supabase.from("medical_drawings").select("*, image:medical_images(storage_path)").eq("status", filter.status ?? "active").order("created_at")
  if (filter.visitId) q = q.eq("visit_id", filter.visitId)
  if (filter.drawingId) q = q.eq("id", filter.drawingId)
  if (filter.patientId) q = q.eq("patient_id", filter.patientId)
  const { data, error } = await q
  if (error) {
    logDbError("loadDrawings", error)
    throw new Error("Drawings could not be loaded.")
  }
  const rows = (data ?? []) as (MedicalDrawing & { image: { storage_path: string } | null })[]
  const paths = rows.map((r) => r.image?.storage_path).filter((p): p is string => !!p)
  let urlFor = new Map<string, string>()
  if (paths.length) {
    const { data: signed, error: signError } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrls(paths, ttlSeconds)
    if (signError) console.error(`[drawings] signing image URLs failed: ${signError.message}`)
    urlFor = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl as string]))
  }
  return rows.map(({ image, ...drawing }) => ({
    drawing: drawing as MedicalDrawing,
    background: image ? (urlFor.get(image.storage_path) ?? null) : drawing.template_key ? `/templates/${drawing.template_key}.svg` : null,
  }))
}

/**
 * Same, with the original image embedded as a data: URL (for PDFs: no
 * network fetch, no expiry). A missing image fails the document instead of
 * producing a PDF without the ultrasound.
 */
export async function loadDrawingsEmbedded(filter: { visitId?: string; drawingId?: string }): Promise<LoadedDrawing[]> {
  const supabase = await createClient()
  let q = supabase.from("medical_drawings").select("*, image:medical_images(storage_path, mime_type)").eq("status", "active").order("created_at")
  if (filter.visitId) q = q.eq("visit_id", filter.visitId)
  if (filter.drawingId) q = q.eq("id", filter.drawingId)
  const { data, error } = await q
  if (error) {
    logDbError("loadDrawingsEmbedded", error)
    throw new Error("Drawings could not be loaded.")
  }
  const rows = (data ?? []) as (MedicalDrawing & { image: { storage_path: string; mime_type: string } | null })[]
  return Promise.all(
    rows.map(async ({ image, ...drawing }) => {
      if (!image) return { drawing: drawing as MedicalDrawing, background: drawing.template_key ? `/templates/${drawing.template_key}.svg` : null }
      const { data: blob, error: dlError } = await supabase.storage.from(DOCUMENTS_BUCKET).download(image.storage_path)
      if (dlError || !blob) {
        console.error(`[drawings] image download for document failed: ${dlError?.message ?? "missing"}`)
        throw new Error("Ultrasound image could not be loaded.")
      }
      const background = `data:${image.mime_type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`
      return { drawing: drawing as MedicalDrawing, background }
    }),
  )
}
