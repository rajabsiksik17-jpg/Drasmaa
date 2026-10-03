"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { ActionError } from "@/lib/errors"

/** Human-readable, translated message for an action error. */
export function useActionError() {
  const t = useTranslations("errors")
  const tf = useTranslations("fields")
  const message = useCallback(
    (error: ActionError) => {
      const base = t(error.code, { detail: error.detail ?? "" })
      if (error.fields?.length) {
        const names = error.fields.map((f) => (tf.has(f) ? tf(f) : f)).join(", ")
        return `${base} (${names})`
      }
      return base
    },
    [t, tf],
  )
  const showError = useCallback(
    (error: ActionError) => {
      toast.error(message(error))
    },
    [message],
  )
  return { message, showError }
}
