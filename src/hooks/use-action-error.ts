"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { ActionError } from "@/lib/errors"

/**
 * Human-readable, translated message for an action error. `op` names the
 * operation ("createPatient", "recordPayment", …): generic failures then say
 * *what* failed ("Could not create the patient file. Please try again.")
 * instead of a vague "something went wrong". Technical details are logged on
 * the server only.
 */
export function useActionError() {
  const t = useTranslations("errors")
  const tf = useTranslations("fields")
  const message = useCallback(
    (error: ActionError, op?: string) => {
      if (op && (error.code === "unexpected" || error.code === "network") && t.has(`op.${op}`)) {
        return error.code === "network" ? `${t(`op.${op}`)} ${t("checkConnection")}` : t(`op.${op}`)
      }
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
    (error: ActionError, op?: string) => {
      toast.error(message(error, op))
    },
    [message],
  )
  return { message, showError }
}
