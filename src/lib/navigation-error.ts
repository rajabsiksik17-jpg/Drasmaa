/** Next.js control-flow errors (redirect / notFound / forbidden) must keep propagating. */
export function isNavigationError(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")
}
