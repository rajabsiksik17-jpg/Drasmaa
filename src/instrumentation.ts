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
  const digest = (error as { digest?: string } | null)?.digest
  // Redirects / not-found are control flow, not errors.
  if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")) return
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { reportServerError } = await import("./lib/observability/error-log")
  await reportServerError(error, {
    path: request.path,
    method: request.method,
    route: context.routePath,
    source: String((context as { renderSource?: string }).renderSource ?? context.routeType ?? ""),
    digest,
  })
}
