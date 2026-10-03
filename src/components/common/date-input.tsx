"use client"

import { useId, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarDays } from "lucide-react"
import { arSA, enGB } from "react-day-picker/locale"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { autoSlashDate, formatDate, parseDisplayDate, type IsoDate } from "@/lib/dates"
import { cn } from "@/lib/utils"

export interface DateInputProps {
  /** ISO calendar date (yyyy-MM-dd) as stored in Postgres, or null. */
  value: IsoDate | null | undefined
  /** Called only with a valid ISO date, or null when cleared. */
  onChange: (value: IsoDate | null) => void
  /** default = app form field · paper = medical paper line · cell = compact grid cell */
  variant?: "default" | "paper" | "cell"
  /** Paper variant: draw the dotted writing line (off inside table cells). */
  underline?: boolean
  min?: IsoDate
  max?: IsoDate
  id?: string
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  className?: string
  "aria-label"?: string
  onBlur?: () => void
  /** Extra data-* attributes for paper styling (saved/conflict/imported). */
  dataAttrs?: Record<string, string | undefined>
}

const toDate = (iso: IsoDate) => {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}
const fromDate = (date: Date): IsoDate =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

/**
 * The one date field used everywhere: type/paste DD/MM/YYYY or pick from the
 * calendar. Display is always DD/MM/YYYY (deterministic on server and
 * client); the value exchanged with the app/database is ISO yyyy-MM-dd.
 */
export function DateInput({
  value,
  onChange,
  variant = "default",
  underline = true,
  min,
  max,
  id,
  disabled,
  invalid,
  autoFocus,
  className,
  onBlur,
  dataAttrs,
  ...aria
}: DateInputProps) {
  const t = useTranslations("dateInput")
  const locale = useLocale()
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
  const [typing, setTyping] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)

  const stored = value ? formatDate(value) : ""
  // The cell variant shows the short dd/mm form until it is being edited.
  const display = typing ?? (variant === "cell" && !focused && stored ? stored.slice(0, 5) : stored)

  const check = (text: string): string | null => {
    const parsed = parseDisplayDate(text)
    if (parsed.ok) {
      if ((min && parsed.iso < min) || (max && parsed.iso > max)) return t("outOfRange", { min: min ? formatDate(min) : "…", max: max ? formatDate(max) : "…" })
      return null
    }
    if (parsed.reason === "empty") return null
    return parsed.reason === "incomplete" ? t("incomplete") : t("invalid")
  }
  const error = typing != null && (typing.replace(/\D/g, "").length >= 8 || !focused) ? check(typing) : null

  const accept = (text: string) => {
    const parsed = parseDisplayDate(text)
    if (parsed.ok && !check(text)) {
      if (parsed.iso !== value) onChange(parsed.iso)
    } else if (parsed.ok === false && parsed.reason === "empty" && value) {
      onChange(null)
    }
  }

  const inputClass =
    variant === "default"
      ? cn(
          "h-9 w-full min-w-0 rounded-lg border border-input bg-background ps-3 pe-9 text-sm shadow-xs outline-none transition",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
          (error || invalid) && "border-destructive ring-3 ring-destructive/20",
        )
      : variant === "paper"
        ? cn("paper-input pe-6 tabular-nums", underline && "paper-line", (error || invalid) && "text-red-600")
        : cn("paper-input paper-cell-input pe-0 tabular-nums", (error || invalid) && "text-red-600 ring-1 ring-red-500")

  const [today] = useState(() => new Date())
  const selected = value ? toDate(value) : undefined

  return (
    <span
      className={cn(
        "relative inline-flex min-w-0 flex-col align-baseline",
        variant === "default" && "w-full",
        variant === "paper" && "min-w-[8.75rem]",
        variant === "cell" && "group/date w-full",
        className,
      )}
    >
      <span className="relative flex items-center">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={variant === "cell" ? "" : t("placeholder")}
          dir="ltr"
          aria-label={aria["aria-label"]}
          aria-invalid={Boolean(error || invalid) || undefined}
          aria-describedby={error ? errorId : undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          value={display}
          className={inputClass}
          title={error ?? undefined}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            const next = autoSlashDate(typing ?? stored, e.target.value)
            setTyping(next)
            if (parseDisplayDate(next).ok || next.trim() === "") accept(next)
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain").trim()
            if (!text) return
            e.preventDefault()
            setTyping(text)
            accept(text)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            if (e.key === "Escape") {
              setTyping(null)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onBlur={() => {
            setFocused(false)
            if (typing != null) {
              accept(typing)
              // Keep an invalid entry visible (with its message) so it isn't silently lost.
              if (!check(typing)) setTyping(null)
            }
            onBlur?.()
          }}
          {...dataAttrs}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t("openCalendar")}
              title={t("openCalendar")}
              className={cn(
                "no-print absolute end-1 grid place-items-center rounded text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                variant === "default" && "size-7",
                variant === "paper" && "size-5 text-[color:var(--paper-muted)]",
                variant === "cell" && "size-4 opacity-0 group-hover/date:opacity-100 focus-visible:opacity-100",
              )}
            >
              <CalendarDays className={variant === "default" ? "size-4" : "size-3.5"} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              locale={locale === "ar" ? arSA : enGB}
              selected={selected}
              defaultMonth={selected ?? today}
              startMonth={new Date(1900, 0)}
              endMonth={new Date(today.getFullYear() + 5, 11)}
              disabled={[...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])]}
              onSelect={(date) => {
                setTyping(null)
                setOpen(false)
                onChange(date ? fromDate(date) : null)
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </span>
      {error && variant !== "cell" && (
        <span id={errorId} role="alert" className="no-print mt-0.5 text-[11px] leading-tight font-normal text-destructive">
          {error}
        </span>
      )}
    </span>
  )
}
