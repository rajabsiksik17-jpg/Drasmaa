// Shared (client + server) upload validation rules.

export const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/heic": ["heic"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
}

/** Browsers sometimes send an empty / generic type for office files: infer it from the extension. */
export function mimeForFile(file: { name: string; type: string }) {
  // Only an unknown/generic type is inferred; a declared type is never overridden.
  if (file.type && file.type !== "application/octet-stream") return file.type
  const ext = fileExtension(file.name)
  return Object.entries(ALLOWED_TYPES).find(([, exts]) => exts.includes(ext))?.[0] ?? file.type
}

export const ACCEPT_ATTRIBUTE = Object.entries(ALLOWED_TYPES)
  .flatMap(([mime, exts]) => [mime, ...exts.map((e) => `.${e}`)])
  .join(",")

export const DEFAULT_MAX_UPLOAD_MB = 20

export function fileExtension(name: string) {
  const idx = name.lastIndexOf(".")
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ""
}

export type FileCheck = { ok: true; ext: string } | { ok: false; code: "fileType" | "fileTooLarge" }

/** MIME type, extension and size must all agree. */
export function checkFile(
  file: { name: string; type: string; size: number },
  maxMb = DEFAULT_MAX_UPLOAD_MB,
): FileCheck {
  const ext = fileExtension(file.name)
  const allowedExts = ALLOWED_TYPES[mimeForFile(file)]
  if (!allowedExts || !allowedExts.includes(ext)) return { ok: false, code: "fileType" }
  if (file.size <= 0 || file.size > maxMb * 1024 * 1024) return { ok: false, code: "fileTooLarge" }
  return { ok: true, ext }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
