"use client"

import { Children, cloneElement, isValidElement, useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { ActionError } from "@/lib/errors"

/**
 * One form field with the system-wide validation look: label (+ required
 * marker), the control, a hint, and the exact error right under it. The
 * control receives aria-invalid / aria-describedby automatically.
 */
export function Field({
  id,
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  id: string
  label: React.ReactNode
  required?: boolean
  error?: string | null
  hint?: React.ReactNode
  className?: string
  children: React.ReactElement
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const child = Children.only(children)
  const control = isValidElement(child)
    ? cloneElement(child as React.ReactElement<Record<string, unknown>>, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })
    : child
  return (
    <div className={cn("grid gap-1.5", className)} data-field={id}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            {" "}
            *
          </span>
        )}
      </Label>
      {control}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-1 text-xs font-medium text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** The error line under a control that is laid out by hand (not via <Field>). */
export function FieldMessage({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p id={`${id}-error`} role="alert" className="flex items-start gap-1 text-xs font-medium text-destructive">
      <AlertCircle className="mt-px size-3.5 shrink-0" />
      {children}
    </p>
  )
}

type Rules = Record<string, () => string | null | undefined | false>

/**
 * Field errors for a form: validate every field at once, show all errors,
 * focus + scroll to the first invalid field, clear an error as soon as the
 * field is fixed, and map server-side field errors onto the same fields.
 */
export function useFieldErrors() {
  const tv = useTranslations("validation")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const focus = useCallback((id: string | undefined) => {
    if (!id || typeof document === "undefined") return
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
      // A wrapper (e.g. a picker) hands focus to its first control.
      const target = el && !el.matches("input, select, textarea, button") ? (el.querySelector<HTMLElement>("input, select, textarea, button") ?? el) : el
      target?.focus({ preventScroll: true })
    })
  }, [])

  /** Runs every rule (in order); returns true when all pass. Rule keys are field ids. */
  const validate = useCallback(
    (rules: Rules) => {
      const next: Record<string, string> = {}
      for (const [id, rule] of Object.entries(rules)) {
        const res = rule()
        if (res) next[id] = res
      }
      setErrors(next)
      focus(Object.keys(next)[0])
      return Object.keys(next).length === 0
    },
    [focus],
  )

  /** Server validation (ActionError.fields) → the same field errors. */
  const fromAction = useCallback(
    (error: ActionError, fieldIds: Record<string, string>) => {
      if (!error.fields?.length) return false
      const next: Record<string, string> = {}
      for (const f of error.fields) {
        const id = fieldIds[f]
        if (id) next[id] = tv.has(`server.${f}`) ? tv(`server.${f}`) : tv("invalid")
      }
      if (!Object.keys(next).length) return false
      setErrors(next)
      focus(Object.keys(next)[0])
      return true
    },
    [focus, tv],
  )

  const clear = useCallback((id: string) => setErrors((e) => (e[id] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== id)) : e)), [])

  return { errors, validate, fromAction, clear, setErrors, t: tv }
}
