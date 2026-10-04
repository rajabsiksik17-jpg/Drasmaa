"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Check, Loader2, Pencil, X } from "lucide-react"
import { toast } from "sonner"
import { saveRecord } from "@/lib/actions/records"
import { useActionError } from "@/hooks/use-action-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DateInput } from "@/components/common/date-input"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

type FieldType = "text" | "textarea" | "date" | "number" | "select" | "tel"

export interface InlineEditProps {
  table: string
  recordKey: string
  field: string
  version: number
  value: string | number | null
  type?: FieldType
  options?: { value: string; label: string }[]
  /** Rendered value in display mode (defaults to the raw value). */
  display?: React.ReactNode
  label: string
  canEdit?: boolean
  placeholder?: string
  className?: string
  /** Visual tone for critical values (e.g. drug allergy). */
  tone?: "default" | "danger"
  reason?: string | null
  onSaved?: (row: Record<string, unknown>) => void
}

/**
 * Click-to-edit for a single field, usable anywhere the value is shown.
 * Display → (hover/focus shows pencil) → Editing → Saving → Saved ✓ | Error.
 * Writes go to the single source row with version checking; on success the
 * surrounding server components are refreshed so every view agrees.
 */
export function InlineEdit({
  table,
  recordKey,
  field,
  version,
  value,
  type = "text",
  options,
  display,
  label,
  canEdit = true,
  placeholder,
  className,
  tone = "default",
  reason,
  onSaved,
}: InlineEditProps) {
  const t = useTranslations("inline")
  const router = useRouter()
  const { message } = useActionError()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value == null ? "" : String(value))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useSafeTransition()
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null)

  // The draft is (re)initialised from the current value when editing starts.
  const startEditing = () => {
    setDraft(value == null ? "" : String(value))
    setError(null)
    setEditing(true)
  }
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])
  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 1600)
    return () => clearTimeout(timer)
  }, [saved])

  const cancel = () => {
    setEditing(false)
    setError(null)
    setDraft(value == null ? "" : String(value))
  }

  const commit = () => {
    const normalized = draft.trim()
    const current = value == null ? "" : String(value)
    if (normalized === current) {
      setEditing(false)
      return
    }
    let next: string | number | null = normalized === "" ? null : normalized
    if (type === "number" && next != null) {
      const n = Number(next)
      if (!Number.isFinite(n)) {
        setError(t("invalidNumber"))
        return
      }
      next = n
    }
    startTransition(async () => {
      const res = await saveRecord({ table, key: recordKey, patch: { [field]: next }, expectedVersion: version, reason })
      if (res.ok) {
        setEditing(false)
        setError(null)
        setSaved(true)
        toast.success(t("saved", { field: label }))
        onSaved?.(res.data.row)
        router.refresh()
      } else if (res.error.code === "conflict") {
        setError(message(res.error))
        toast.warning(t("conflict"))
        router.refresh()
      } else {
        setError(message(res.error))
      }
    })
  }

  const shown =
    display ??
    (type === "select" && options ? options.find((o) => o.value === value)?.label : value) ??
    null

  if (!editing) {
    return (
      <span className={cn("group/inline relative inline-flex min-w-0 max-w-full items-center gap-1", className)}>
        <span
          className={cn(
            "min-w-0 truncate",
            shown == null || shown === "" ? "text-muted-foreground italic" : "",
            tone === "danger" && "font-bold text-allergy",
          )}
        >
          {shown == null || shown === "" ? (canEdit ? t("empty") : "—") : shown}
        </span>
        <AnimatePresence>
          {saved && (
            <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
              <Check className="size-3.5 text-success" aria-label={t("savedShort")} />
            </motion.span>
          )}
        </AnimatePresence>
        {canEdit && (
          <button
            type="button"
            onClick={startEditing}
            className="no-print inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/inline:opacity-100 [@media(hover:hover)]:opacity-0"
            aria-label={t("edit", { field: label })}
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </span>
    )
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      cancel()
    } else if (e.key === "Enter" && (type !== "textarea" || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commit()
    }
  }

  return (
    <motion.span
      initial={{ opacity: 0.6, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("inline-flex w-full max-w-md flex-col gap-1", className)}
    >
      <span className="flex items-start gap-1.5">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        {type === "date" ? (
          <DateInput id={id} value={draft || null} onChange={(v) => setDraft(v ?? "")} autoFocus className="flex-1" />
        ) : type === "textarea" ? (
          <Textarea id={id} ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} className="min-h-20" />
        ) : type === "select" ? (
          <select
            id={id}
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">—</option>
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={id}
            ref={inputRef}
            type={type === "number" ? "text" : type}
            inputMode={type === "number" ? "decimal" : type === "tel" ? "tel" : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="h-8"
          />
        )}
        <Button size="icon-sm" onClick={commit} disabled={pending} aria-label={t("save")}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button size="icon-sm" variant="outline" onClick={cancel} disabled={pending} aria-label={t("cancel")}>
          <X />
        </Button>
      </span>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </motion.span>
  )
}
