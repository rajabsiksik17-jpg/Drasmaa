// Translate database / API failures into stable, user-facing error codes
// (rendered via messages `errors.<code>`). Technical details are logged
// server-side without patient data.

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "duplicate"
  | "doubleBooking"
  | "invalidTransition"
  | "rescheduleRequired"
  | "reasonRequired"
  | "missingFields"
  | "pregnancyCaseRequired"
  | "visitCancelled"
  | "invalidValue"
  | "invalidReference"
  | "validation"
  | "uploadFailed"
  | "fileTooLarge"
  | "fileType"
  | "network"
  | "rateLimited"
  | "accountLocked"
  | "otpInvalid"
  | "otpExpired"
  | "otpLocked"
  | "otpCooldown"
  | "emailNotConfigured"
  | "emailFailed"
  | "encryptionKeyMissing"
  | "serviceKeyMissing"
  | "invalidPhone"
  | "invalidEmail"
  | "pdfFailed"
  | "registerClosed"
  | "outsideHours"
  | "discountLimit"
  | "paymentMethodDisabled"
  | "schemaOutdated"
  | "inUse"
  | "unexpected"

export interface ActionError {
  code: ErrorCode
  /** Field names (missing/invalid) the UI can point the user to. */
  fields?: string[]
  /** Safe extra detail (e.g. remaining attempts, wait seconds, email error code). */
  detail?: string | number
}

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: ActionError }

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data })
export const fail = (code: ErrorCode, fields?: string[], detail?: string | number): ActionResult<never> => ({
  ok: false,
  error: { code, ...(fields?.length ? { fields } : {}), ...(detail != null ? { detail } : {}) },
})

interface PgLikeError {
  code?: string
  message?: string
  hint?: string | null
  details?: string | null
}

const HINTS: Record<string, ErrorCode> = {
  RESCHEDULE_REQUIRED: "rescheduleRequired",
  INVALID_TRANSITION: "invalidTransition",
  REASON_REQUIRED: "reasonRequired",
  MISSING_FIELDS: "missingFields",
  PREGNANCY_CASE_REQUIRED: "pregnancyCaseRequired",
  VISIT_CANCELLED: "visitCancelled",
  REGISTER_CLOSED: "registerClosed",
  OUTSIDE_HOURS: "outsideHours",
  DISCOUNT_LIMIT: "discountLimit",
  PAYMENT_METHOD_DISABLED: "paymentMethodDisabled",
}

export function mapDbError(error: PgLikeError | null | undefined): ActionError {
  if (!error) return { code: "unexpected" }
  const hint = error.hint ?? ""
  if (HINTS[hint]) {
    const fields = hint === "MISSING_FIELDS" && error.details ? error.details.split(",").filter(Boolean) : undefined
    if (hint === "DISCOUNT_LIMIT" && error.details) return { code: "discountLimit", detail: error.details }
    return fields ? { code: HINTS[hint], fields } : { code: HINTS[hint] }
  }
  // The database is older than the application (migrations not applied).
  if (error.code && SCHEMA_CODES.has(error.code)) return { code: "schemaOutdated" }
  switch (error.code) {
    case "23P01":
      return { code: "doubleBooking" }
    case "23505":
      return { code: "duplicate" }
    case "23503":
      return { code: "invalidReference" }
    case "23502":
      return { code: "missingFields" }
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
      return { code: "invalidValue" }
    case "42501":
      return { code: "forbidden" }
    case "P0002":
    case "PGRST116":
      return { code: "notFound" }
    default:
      return { code: "unexpected" }
  }
}

// PostgREST codes meaning "the database schema is older than this app".
const SCHEMA_CODES = new Set(["PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"])

/**
 * Server-side log of the real failure. `message` is always logged (it names
 * the constraint/column, not patient data); `details` can contain row values,
 * so it is only logged in development.
 */
export function logDbError(context: string, error: PgLikeError | null | undefined) {
  if (!error) return
  const parts = [`code=${error.code ?? "?"}`, `message=${error.message ?? ""}`]
  if (error.hint) parts.push(`hint=${error.hint}`)
  if (process.env.NODE_ENV !== "production" && error.details) parts.push(`details=${error.details}`)
  console.error(`[db] ${context} failed: ${parts.join(" | ")}`)
  if (error.code && SCHEMA_CODES.has(error.code)) {
    console.error("[db] The database schema is behind the application. Apply migrations: npx supabase db push")
  }
}

export function dbFail(context: string, error: PgLikeError | null | undefined): ActionResult<never> {
  logDbError(context, error)
  return { ok: false, error: mapDbError(error) }
}
