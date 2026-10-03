import "server-only"
import { createClient } from "@/lib/supabase/server"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"
import type { MedicalDrawing } from "@/types/db"

export interface LoadedDrawing {
  drawing: MedicalDrawing
  background: string | null
}

/**
 * Drawings with a short-lived URL for the original image (RLS checked).
 * Diagram drawings use the static clinic template.
 */
export async function loadDrawings(filter: { visitId?: string; drawingId?: string; patientId?: string }, ttlSeconds = 900): Promise<LoadedDrawing[]> {
  const supabase = await createClient()
  let q = supabase.from("medical_drawings").select("*, image:medical_images(storage_path)").eq("status", "active").order("created_at")
  if (filter.visitId) q = q.eq("visit_id", filter.visitId)
  if (filter.drawingId) q = q.eq("id", filter.drawingId)
  if (filter.patientId) q = q.eq("patient_id", filter.patientId)
  const { data } = await q
  const rows = (data ?? []) as (MedicalDrawing & { image: { storage_path: string } | null })[]
  const paths = rows.map((r) => r.image?.storage_path).filter((p): p is string => !!p)
  const signed = paths.length ? (await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrls(paths, ttlSeconds)).data ?? [] : []
  const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]))
  return rows.map(({ image, ...drawing }) => ({
    drawing: drawing as MedicalDrawing,
    background: image ? (urlFor.get(image.storage_path) ?? null) : drawing.template_key ? `/templates/${drawing.template_key}.svg` : null,
  }))
}

/** Same, with the original image embedded as a data: URL (for PDFs: no network fetch, no expiry). */
export async function loadDrawingsEmbedded(filter: { visitId?: string; drawingId?: string }): Promise<LoadedDrawing[]> {
  const supabase = await createClient()
  let q = supabase.from("medical_drawings").select("*, image:medical_images(storage_path, mime_type)").eq("status", "active").order("created_at")
  if (filter.visitId) q = q.eq("visit_id", filter.visitId)
  if (filter.drawingId) q = q.eq("id", filter.drawingId)
  const { data } = await q
  const rows = (data ?? []) as (MedicalDrawing & { image: { storage_path: string; mime_type: string } | null })[]
  return Promise.all(
    rows.map(async ({ image, ...drawing }) => {
      if (!image) return { drawing: drawing as MedicalDrawing, background: drawing.template_key ? `/templates/${drawing.template_key}.svg` : null }
      const { data: blob } = await supabase.storage.from(DOCUMENTS_BUCKET).download(image.storage_path)
      const background = blob ? `data:${image.mime_type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}` : null
      return { drawing: drawing as MedicalDrawing, background }
    }),
  )
}
