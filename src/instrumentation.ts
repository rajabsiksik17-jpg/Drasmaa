import type { Instrumentation } from "next"

// Runs once per server start. Background jobs (appointment reminders,
// email outbox, document retention) only run in the Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/jobs/scheduler")
    startScheduler()
  }
}

/**
 * Server-side errors (page renders, Server Actions, route handlers) are
 * recorded with their digest — the "reference" number shown on the error
 * screen — so an administrator can see the real cause. Only the error, the
 * route and the digest are stored: no request bodies, cookies or headers.
 * Logging must never break a request, so every failure here is swallowed
 * after a console message.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const err = error as Error & { digest?: string }
  const digest = err?.digest ?? null
  // Redirects / not-found are control flow, not errors.
  if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")) return
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  console.error(`[error] digest=${digest ?? "-"} path=${request.path} route=${context.routePath} ${err?.message ?? String(error)}`)
  if (!url || !key || process.env.NEXT_RUNTIME !== "nodejs") return
  try {
    await fetch(`${url}/rest/v1/app_error_logs`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        digest: digest ? String(digest).slice(0, 100) : null,
        message: String(err?.message ?? error).slice(0, 2000),
        stack: err?.stack ? String(err.stack).slice(0, 8000) : null,
        // Path only: query strings can contain identifiers.
        path: String(request.path).split("?")[0].slice(0, 500),
        method: String(request.method).slice(0, 10),
        route_path: String(context.routePath ?? "").slice(0, 300),
        route_type: String(context.routeType ?? "").slice(0, 30),
        render_source: String((context as { renderSource?: string }).renderSource ?? "").slice(0, 60),
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (logError) {
    console.error("[error] could not store the error log", logError)
  }
}
