"use client"

import { useId, useState } from "react"
import { useTranslations } from "next-intl"
import type { RecordController } from "@/hooks/use-record"
import { cn } from "@/lib/utils"
import { DateInput } from "@/components/common/date-input"

/* Inputs that live *inside* a paper form: borderless, ink-coloured, and
   bound to a useRecord() controller (autosave + conflict protection). */

type Row = { version: number }

interface BaseProps<T extends Row> {
  rec: RecordController<T>
  field: keyof T & string
  label?: string
  className?: string
  disabled?: boolean
  imported?: boolean
  id?: string
}

function stateAttrs<T extends Row>(rec: RecordController<T>, field: string, imported?: boolean) {
  return {
    "data-saved": rec.remoteChanged.has(field) ? "true" : undefined,
    "data-conflict": rec.conflict && rec.pendingFields.has(field) ? "true" : undefined,
    "data-imported": imported && !rec.pendingFields.has(field) ? "true" : undefined,
  }
}

export function MedicalInput<T extends Row>({
  rec,
  field,
  label,
  className,
  disabled,
  imported,
  line = true,
  placeholder,
  maxLength = 300,
  id,
}: BaseProps<T> & { line?: boolean; placeholder?: string; maxLength?: number }) {
  const value = (rec.values[field] as string | null) ?? ""
  return (
    <input
      id={id}
      type="text"
      aria-label={label}
      className={cn("paper-input", line && "paper-line", className)}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled || rec.readOnly}
      onChange={(e) => rec.set(field, e.target.value as T[typeof field])}
      {...stateAttrs(rec, field, imported)}
    />
  )
}

export function MedicalTextarea<T extends Row>({
  rec,
  field,
  label,
  className,
  disabled,
  rows = 3,
  placeholder,
  id,
}: BaseProps<T> & { rows?: number; placeholder?: string }) {
  const value = (rec.values[field] as string | null) ?? ""
  return (
    <textarea
      id={id}
      aria-label={label}
      rows={rows}
      className={cn("paper-input block", className)}
      value={value}
      maxLength={8000}
      placeholder={placeholder}
      disabled={disabled || rec.readOnly}
      onChange={(e) => rec.set(field, e.target.value as T[typeof field])}
      {...stateAttrs(rec, field)}
    />
  )
}

/** Numeric input that keeps the raw text while typing and stores a number|null. */
export function MedicalNumberInput<T extends Row>({
  rec,
  field,
  label,
  className,
  disabled,
  imported,
  integer = true,
  min,
  max,
  line = true,
  id,
}: BaseProps<T> & { integer?: boolean; min?: number; max?: number; line?: boolean }) {
  const stored = rec.values[field] as number | null | undefined
  // Raw text only while the user is typing; otherwise show the stored value
  // (so realtime/reload updates appear immediately).
  const [typing, setTyping] = useState<string | null>(null)
  const text = typing ?? (stored == null ? "" : String(stored))
  const invalid = typing != null && typing.trim() !== "" && !isValid(typing)

  function isValid(raw: string) {
    const n = Number(raw)
    return Number.isFinite(n) && (!integer || Number.isInteger(n)) && (min == null || n >= min) && (max == null || n <= max)
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cn("paper-input text-center tabular-nums", line && "paper-line", invalid && "text-red-600", className)}
      value={text}
      disabled={disabled || rec.readOnly}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".")
        setTyping(raw)
        if (raw.trim() === "") rec.set(field, null as T[typeof field])
        else if (isValid(raw)) rec.set(field, Number(raw) as T[typeof field])
      }}
      onBlur={() => {
        // Keep an invalid entry visible (flagged) so it isn't silently lost.
        if (typing == null || typing.trim() === "" || isValid(typing)) setTyping(null)
      }}
      {...stateAttrs(rec, field, imported)}
    />
  )
}

export function MedicalDateInput<T extends Row>({
  rec,
  field,
  label,
  className,
  disabled,
  imported,
  line = true,
  id,
}: BaseProps<T> & { line?: boolean }) {
  const value = (rec.values[field] as string | null) ?? null
  return (
    <DateInput
      id={id}
      variant="paper"
      underline={line}
      aria-label={label}
      className={className}
      value={value}
      disabled={disabled || rec.readOnly}
      onChange={(v) => rec.set(field, v as T[typeof field])}
      dataAttrs={stateAttrs(rec, field, imported)}
    />
  )
}

/** Yes / No (unanswered = null) — the paper's tick boxes. */
export function MedicalYesNo<T extends Row>({
  rec,
  field,
  label,
  className,
  disabled,
  hideLabel = false,
}: BaseProps<T> & { /** Label already printed by the surrounding paper line. */ hideLabel?: boolean }) {
  const t = useTranslations("common")
  const value = rec.values[field] as boolean | null
  const name = useId()
  return (
    <span role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-3", className)} {...stateAttrs(rec, field)}>
      {label && !hideLabel && <span className="paper-label">{label}</span>}
      {[true, false].map((option) => (
        <label key={String(option)} className="inline-flex cursor-pointer items-center gap-1 text-[0.95em]">
          <input
            type="radio"
            className="paper-check"
            name={name}
            checked={value === option}
            disabled={disabled || rec.readOnly}
            onChange={() => rec.set(field, option as T[typeof field])}
            onClick={() => {
              // Clicking the selected option again clears the answer.
              if (value === option) rec.set(field, null as T[typeof field])
            }}
          />
          {option ? t("yes") : t("no")}
        </label>
      ))}
    </span>
  )
}

export function MedicalRadioGroup<T extends Row>({
  rec,
  field,
  label,
  options,
  className,
  disabled,
  direction = "row",
}: BaseProps<T> & { options: readonly { value: string; label: string }[]; direction?: "row" | "column" }) {
  const value = rec.values[field] as string | null
  const groupName = useId()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex gap-x-4 gap-y-1", direction === "column" ? "flex-col" : "flex-wrap items-center", className)}
    >
      {options.map((o) => (
        <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            className="paper-check"
            name={groupName}
            value={o.value}
            checked={value === o.value}
            disabled={disabled || rec.readOnly}
            onChange={() => rec.set(field, o.value as T[typeof field])}
            onClick={() => {
              if (value === o.value) rec.set(field, null as T[typeof field])
            }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

export function MedicalCheckboxGroup<T extends Row>({
  rec,
  field,
  label,
  options,
  className,
  disabled,
  direction = "column",
}: BaseProps<T> & { options: readonly { value: string; label: string }[]; direction?: "row" | "column" }) {
  const value = (rec.values[field] as string[] | null) ?? []
  return (
    <div role="group" aria-label={label} className={cn("flex gap-x-4 gap-y-1", direction === "column" ? "flex-col" : "flex-wrap", className)}>
      {options.map((o) => (
        <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            className="paper-check"
            checked={value.includes(o.value)}
            disabled={disabled || rec.readOnly}
            onChange={(e) => {
              const next = e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value)
              rec.set(field, next as T[typeof field])
            }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

export function MedicalSelect<T extends Row>({
  rec,
  field,
  label,
  options,
  className,
  disabled,
  placeholder = "—",
  id,
}: BaseProps<T> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const value = (rec.values[field] as string | null) ?? ""
  return (
    <select
      id={id}
      aria-label={label}
      className={cn("paper-input paper-line cursor-pointer", className)}
      value={value}
      disabled={disabled || rec.readOnly}
      onChange={(e) => rec.set(field, (e.target.value || null) as T[typeof field])}
      {...stateAttrs(rec, field)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** A label + dotted-line field pair laid out like the paper form. */
export function PaperRow({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline gap-2", className)}>
      <span className="paper-label shrink-0">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** System-calculated value (visibly distinct from entered data). */
export function Calculated({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[0.92em]" title={title}>
      <span className="text-[color:var(--paper-muted)]">{label}</span>
      <span className="rounded bg-[color:var(--paper-fill)] px-1.5 font-medium tabular-nums">{value || "—"}</span>
      <span aria-hidden className="text-[0.75em] text-[color:var(--paper-muted)]">ƒ</span>
    </span>
  )
}
