"use client"

import { useCallback, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

/** Next.js control-flow errors (redirect / notFound) must keep propagating. */
function isNavigationError(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")
}

/**
 * Drop-in replacement for `useTransition` for Server Action calls.
 *
 * A Server Action that *throws* (connection lost, server restarted, a new
 * deployment replaced the action) would otherwise be re-thrown by React into
 * the nearest error boundary and replace the whole page with an error
 * screen. Here it becomes a clear, retryable message; the form keeps its
 * data and the button is enabled again.
 */
export function useSafeTransition(): [boolean, (fn: () => Promise<unknown> | void) => void] {
  const [pending, startTransition] = useTransition()
  const t = useTranslations("errors")
  const start = useCallback(
    (fn: () => Promise<unknown> | void) => {
      startTransition(async () => {
        try {
          await fn()
        } catch (error) {
          if (isNavigationError(error)) throw error
          const offline = typeof navigator !== "undefined" && !navigator.onLine
          console.error("[action] failed", error)
          toast.error(offline ? t("network") : t("actionFailed"))
        }
      })
    },
    [t],
  )
  return [pending, start]
}
