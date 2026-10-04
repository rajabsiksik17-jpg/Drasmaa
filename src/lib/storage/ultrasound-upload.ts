"use client"

import { discardUltrasoundUpload, finalizeUltrasoundUpload, prepareUltrasoundUpload } from "@/lib/actions/drawings"
import type { ActionError } from "@/lib/errors"
import type { ClinicalContext } from "@/types/db"

export const ULTRASOUND_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"])

/** Width/height as the browser decodes the file (also proves it is a readable image). */
export function readImageSize(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("unreadable"))
    }
    img.src = url
  })
}

/**
 * Client-side pre-checks (the server checks again, including the file
 * content). iPhones may hand over HEIC photos: those get a specific message.
 */
export function precheckUltrasound(file: File, maxMb: number): "heic" | "fileType" | "fileTooLarge" | null {
  const name = file.name.toLowerCase()
  if (file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/.test(name)) return "heic"
  if (!ALLOWED.has(file.type) || !/\.(jpe?g|png|webp)$/.test(name)) return "fileType"
  if (file.size <= 0 || file.size > Math.min(maxMb, 25) * 1024 * 1024) return "fileTooLarge"
  return null
}

/**
 * Private upload in three steps: signed URL → direct PUT to Storage (real
 * progress, cancellable) → server verification + registration. A failed or
 * cancelled upload leaves nothing behind.
 */
export async function uploadUltrasound(
  file: File,
  opts: { visitId: string; context: ClinicalContext; width: number; height: number },
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ ok: true; drawingId: string } | { ok: false; error: ActionError; cancelled?: boolean }> {
  const prepared = await prepareUltrasoundUpload({ visitId: opts.visitId, fileName: file.name, mimeType: file.type, size: file.size })
  if (!prepared.ok) return prepared
  if (signal.aborted) {
    await discardUltrasoundUpload(prepared.data.path)
    return { ok: false, error: { code: "uploadFailed" }, cancelled: true }
  }

  const status = await new Promise<"ok" | "failed" | "aborted" | "network">((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", prepared.data.signedUrl)
    xhr.setRequestHeader("Content-Type", file.type)
    xhr.setRequestHeader("x-upsert", "false")
    xhr.timeout = 10 * 60_000
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(0.97, e.loaded / e.total))
    }
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? "ok" : "failed")
    xhr.onerror = () => resolve("network")
    xhr.ontimeout = () => resolve("network")
    xhr.onabort = () => resolve("aborted")
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(file)
  })
  if (status !== "ok") {
    await discardUltrasoundUpload(prepared.data.path).catch((e) => console.error("[upload] cleanup failed", e))
    return { ok: false, error: { code: status === "network" ? "network" : "uploadFailed" }, cancelled: status === "aborted" }
  }

  const done = await finalizeUltrasoundUpload({
    visitId: opts.visitId,
    path: prepared.data.path,
    fileName: file.name,
    context: opts.context,
    width: opts.width,
    height: opts.height,
  })
  if (!done.ok) return done
  onProgress(1)
  return { ok: true, drawingId: done.data.drawingId }
}
