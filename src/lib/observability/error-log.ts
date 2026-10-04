// Server-only error log (app_error_logs, migration 0018): the real cause of a
// failure an end user only sees as a friendly message / reference number.
// Stores the error, the place and an optional digest — never request bodies,
// cookies or patient data. Logging must never throw.
export async function reportServerError(
  error: unknown,
  where: { path?: string | null; route?: string | null; method?: string | null; source?: string | null; digest?: string | null },
) {
  const err = error as (Error & { digest?: string; code?: string; hint?: string }) | null
  const message = [err?.message ?? String(error), err?.code ? `code=${err.code}` : "", err?.hint ? `hint=${err.hint}` : ""].filter(Boolean).join(" | ")
  console.error(`[error] ${where.source ?? ""} ${where.path ?? ""} ${message}`)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key || process.env.NEXT_RUNTIME === "edge") return
  try {
    await fetch(`${url}/rest/v1/app_error_logs`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        digest: (where.digest ?? err?.digest ?? null)?.toString().slice(0, 100) ?? null,
        message: message.slice(0, 2000),
        stack: err?.stack ? String(err.stack).slice(0, 8000) : null,
        path: (where.path ?? "").split("?")[0].slice(0, 500) || null,
        method: where.method?.slice(0, 10) ?? null,
        route_path: where.route?.slice(0, 300) ?? null,
        route_type: null,
        render_source: where.source?.slice(0, 60) ?? null,
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (logError) {
    console.error("[error] could not store the error log", logError)
  }
}
