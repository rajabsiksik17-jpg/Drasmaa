"use client"

import { discardUpload, finalizeUpload, prepareUpload } from "@/lib/actions/documents"
import type { ActionError } from "@/lib/errors"
import { mimeForFile } from "@/lib/storage/files"
import type { DocumentCategory } from "@/types/db"

export interface UploadLinks {
  patientId: string
  visitId?: string | null
  fertilityCaseId?: string | null
  pregnancyCaseId?: string | null
  cycleId?: string | null
  investigationId?: string | null
}

/**
 * Private upload in three steps:
 *   1. server validates + issues a one-time signed upload URL,
 *   2. browser PUTs the bytes directly to Storage (real progress events),
 *   3. server verifies the object and registers the document.
 * A failed step 3 removes the object, so no half-saved documents exist.
 */
export async function uploadDocument(
  file: File,
  opts: UploadLinks & {
    category: DocumentCategory
    title?: string | null
    notes?: string | null
    documentDate?: string | null
    tags?: string[]
  },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: true; id: string } | { ok: false; error: ActionError }> {
  const meta = { fileName: file.name, mimeType: mimeForFile(file), size: file.size }
  const prepared = await prepareUpload({ ...opts, ...meta })
  if (!prepared.ok) return prepared

  const put = await new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", prepared.data.signedUrl)
    xhr.setRequestHeader("Content-Type", meta.mimeType)
    xhr.setRequestHeader("x-upsert", "false")
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(0.98, e.loaded / e.total))
    }
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
    xhr.onerror = () => resolve(false)
    xhr.onabort = () => resolve(false)
    signal?.addEventListener("abort", () => xhr.abort())
    xhr.send(file)
  })
  if (!put) {
    await discardUpload(prepared.data.path)
    return { ok: false, error: { code: signal?.aborted ? "uploadFailed" : "network" } }
  }

  const done = await finalizeUpload({ ...opts, ...meta, path: prepared.data.path })
  if (!done.ok) return done
  onProgress(1)
  return { ok: true, id: done.data.id }
}
