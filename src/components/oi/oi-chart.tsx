"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { RotateCcw } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useRecord, type RecordController } from "@/hooks/use-record"
import { useCycleCells, type CellKeys, type CellTable } from "@/hooks/use-cycle-cells"
import { useActionError } from "@/hooks/use-action-error"
import { ConflictBanner } from "@/components/forms/conflict-banner"
import { useCorrectionReason, useRecordLocked } from "@/components/forms/correction-context"
import { MedicalCheckboxGroup, MedicalDateInput, MedicalInput, MedicalNumberInput, MedicalSelect, MedicalTextarea } from "@/components/medical/medical-fields"
import { useRefs } from "@/components/app-context"
import { DateInput } from "@/components/common/date-input"
import { saveRecord } from "@/lib/actions/records"
import { setCycleDay1 } from "@/lib/actions/clinical"
import { useRealtime } from "@/lib/realtime/use-realtime"
import { cycleDates, OI_DAYS } from "@/lib/medical/calculations"
import { FOLLICLE_DAYS, FOLLICLE_ROWS, OI_ADDONS, OI_HORMONES, OI_MEDICATIONS, OI_PROCEDURES, OI_SPERM_RETRIEVAL, SIDES } from "@/lib/medical/oi"
import { formatDate } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { CycleDay, CycleHormone, FertilityCycle } from "@/types/db"
import type { CycleBundle } from "@/lib/data/cycle"

const DAYS = Array.from({ length: OI_DAYS }, (_, i) => i + 1)
// Visual grid: label column + 30 half-columns (Day 1 = 2 halves, Days 2–15 = R|L).
const halfCol = (day: number, side: "R" | "L" = "R") => (day === 1 ? 0 : 2 * (day - 1) + (side === "L" ? 1 : 0))
const MED_ROW0 = 0
const FOL_ROW0 = OI_MEDICATIONS.length // 7
const ENDO_ROW = FOL_ROW0 + FOLLICLE_ROWS // 19

/**
 * Ovulation Induction chart (paper form v1), reproduced structurally:
 * six header boxes (+ Address strip), Cycle day 1–15, Date row,
 * medication rows, hormone block, R/L follicle grid, Endo row, Comments,
 * and the vertical "Ovulation Induction chart" title.
 */
export function OiChart({ bundle, canEdit }: { bundle: CycleBundle; canEdit: boolean }) {
  const t = useTranslations("oi")
  const refs = useRefs()
  const locked = useRecordLocked()
  const readOnly = !canEdit || locked
  const cycle = useRecord({ table: "fertility_cycles", keyField: "id", row: bundle.cycle, readOnly: !canEdit })
  const cells = useCycleCells({
    cycleId: bundle.cycle.id,
    medications: bundle.medications,
    follicles: bundle.follicles,
    endometrium: bundle.endometrium,
  })

  // ---- keyboard grid navigation + spreadsheet-style paste ----
  const gridRef = useRef<HTMLDivElement>(null)
  const focusCell = (r: number, c: number) => {
    const root = gridRef.current
    if (!root) return false
    const el =
      root.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`) ??
      root.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c - 1}"]`) ??
      root.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="0"]`)
    if (!el) return false
    el.focus()
    el.select()
    return true
  }
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLInputElement
    if (el.dataset.r == null) return
    const r = Number(el.dataset.r)
    const c = Number(el.dataset.c)
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0
    const atEnd = el.selectionStart === el.value.length
    let handled = false
    if (e.key === "ArrowDown" || e.key === "Enter") handled = focusCell(r + 1, c)
    else if (e.key === "ArrowUp") handled = focusCell(r - 1, c)
    else if (e.key === "ArrowRight" && atEnd) handled = focusCell(r, c + (r >= FOL_ROW0 && r < ENDO_ROW ? 1 : c === 0 ? 2 : 2))
    else if (e.key === "ArrowLeft" && atStart) handled = focusCell(r, c - (r >= FOL_ROW0 && r < ENDO_ROW ? 1 : 2))
    if (handled) e.preventDefault()
  }

  /** Grid coordinates -> the database cell they represent (mirrors halfCol). */
  const cellAt = (r: number, c: number): { table: CellTable; keys: CellKeys } | null => {
    if (r >= MED_ROW0 && r < FOL_ROW0) {
      if (c !== 0 && c % 2 !== 0) return null
      const day = c === 0 ? 1 : c / 2 + 1
      return day <= OI_DAYS ? { table: "fertility_cycle_medications", keys: { medication_code: OI_MEDICATIONS[r].code, day_number: day } } : null
    }
    if (r >= FOL_ROW0 && r < ENDO_ROW) {
      const day = Math.floor(c / 2) + 1
      if (day < 2 || day > OI_DAYS) return null
      return { table: "fertility_cycle_follicles", keys: { day_number: day, side: c % 2 ? "L" : "R", row_index: r - FOL_ROW0 } }
    }
    if (r === ENDO_ROW && c >= 2 && c % 2 === 0 && c / 2 + 1 <= OI_DAYS) {
      return { table: "fertility_cycle_endometrium", keys: { day_number: c / 2 + 1 } }
    }
    return null
  }
  const onGridPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLInputElement
    const text = e.clipboardData.getData("text/plain")
    if (el.dataset.r == null || !/[\t\n]/.test(text.trim())) return
    e.preventDefault()
    const r0 = Number(el.dataset.r)
    const c0 = Number(el.dataset.c)
    const matrix = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"))
    let applied = 0
    matrix.forEach((row, i) =>
      row.forEach((value, j) => {
        const step = r0 + i >= FOL_ROW0 && r0 + i < ENDO_ROW ? 1 : 2
        const target = cellAt(r0 + i, c0 + j * step)
        if (target && value.length <= 40) {
          cells.set(target.table, target.keys, value.trim())
          applied++
        }
      }),
    )
    if (applied) toast.success(t("pasted", { count: applied }))
  }

  // Plain render function (not a component) so inputs keep focus across renders.
  const cell = (table: CellTable, keys: CellKeys, r: number, c: number, className?: string) => {
    const set = (v: string) => cells.set(table, keys, v)
    return (
      <input
        data-r={r}
        data-c={c}
        aria-label={`${table === "fertility_cycle_follicles" ? `Day ${keys.day_number} ${keys.side} ${(keys.row_index ?? 0) + 1}` : table === "fertility_cycle_endometrium" ? `Endo day ${keys.day_number}` : `${keys.medication_code} day ${keys.day_number}`}`}
        className={cn("paper-input paper-cell-input", className)}
        value={cells.get(table, keys)}
        maxLength={40}
        inputMode={table === "fertility_cycle_medications" ? "text" : "decimal"}
        disabled={readOnly}
        data-saved={cells.isFlashing(table, keys) ? "true" : undefined}
        onChange={(e) => set(e.target.value)}
      />
    )
  }

  return (
    <div className="space-y-3">
      <ConflictBanner rec={cycle} />
      <div className="paper paper-serif print-landscape mx-auto max-w-[297mm] p-3 sm:p-5" dir="ltr">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            {/* Header boxes stack on phones, align to the grid on larger screens */}
            <div className="scroll-x">
              <div className="min-w-[1000px] text-[13px]" ref={gridRef} onKeyDown={onGridKeyDown} onPaste={onGridPaste}>
                <HeaderBoxes cycle={cycle} protocolOptions={refs.activeOptions("oi_protocol", cycle.values.protocol)} />
                <table className="paper-grid mt-0 w-full text-[13px]">
                  <colgroup>
                    <col style={{ width: 92 }} />
                    {Array.from({ length: 30 }, (_, i) => (
                      <col key={i} />
                    ))}
                  </colgroup>
                  <tbody>
                    <tr className="h-7">
                      <td className="px-1.5">Cycle day</td>
                      {DAYS.map((d) => (
                        <td key={d} colSpan={2} className="text-center font-medium">
                          {d}
                        </td>
                      ))}
                    </tr>
                    <DateRow cycleId={bundle.cycle.id} initialDays={bundle.days} readOnly={readOnly} />
                    {OI_MEDICATIONS.map((m, i) => (
                      <tr key={m.code} className="h-7">
                        <td className="px-1.5 whitespace-nowrap">{m.label}</td>
                        {DAYS.map((d) => (
                          <td key={d} colSpan={2}>
                            {cell("fertility_cycle_medications", { medication_code: m.code, day_number: d }, MED_ROW0 + i, halfCol(d))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="h-6 text-[11px]">
                      <td colSpan={3} rowSpan={FOLLICLE_ROWS + 1} className="p-0 align-top">
                        <HormoneBlock hormones={bundle.hormones} readOnly={!canEdit} patientId={bundle.cycle.patient_id} />
                      </td>
                      {FOLLICLE_DAYS.map((d) =>
                        SIDES.map((s) => (
                          <td key={`${d}${s}`} className="text-center font-semibold">
                            {s}
                          </td>
                        )),
                      )}
                    </tr>
                    {Array.from({ length: FOLLICLE_ROWS }, (_, row) => (
                      <tr key={row} className="h-[22px]">
                        {FOLLICLE_DAYS.map((d) =>
                          SIDES.map((s) => (
                            <td key={`${d}${s}`}>
                              {cell("fertility_cycle_follicles", { day_number: d, side: s, row_index: row }, FOL_ROW0 + row, halfCol(d, s), "text-[12px]")}
                            </td>
                          )),
                        )}
                      </tr>
                    ))}
                    <tr className="h-7">
                      <td />
                      <td colSpan={2} className="px-1.5">
                        Endo
                      </td>
                      {FOLLICLE_DAYS.map((d) => (
                        <td key={d} colSpan={2}>
                          {cell("fertility_cycle_endometrium", { day_number: d }, ENDO_ROW, halfCol(d))}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <div className="paper-box mt-2 min-h-24 p-1.5">
                  <span className="paper-label">Comments:</span>
                  <MedicalTextarea rec={cycle} field="comments" rows={3} label={t("comments")} />
                </div>
              </div>
            </div>
          </div>
          <div className="hidden w-8 shrink-0 items-center justify-center sm:flex print:flex">
            <span className="paper-vertical-title text-[22px] tracking-wide">Ovulation Induction chart</span>
          </div>
        </div>
      </div>
      <p className="no-print text-xs text-muted-foreground">{t("snapshotHint")}</p>
    </div>
  )
}

function HeaderBoxes({ cycle, protocolOptions }: { cycle: RecordController<FertilityCycle>; protocolOptions: { value: string; label: string }[] }) {
  const t = useTranslations("oi")
  const grid = "grid grid-cols-[92px_repeat(30,minmax(0,1fr))]"
  return (
    <div className="mb-2 space-y-0">
      <div className={grid}>
        <div className="paper-box col-start-26 col-end-32 mb-1 flex items-baseline gap-1 px-1.5 py-0.5">
          <span className="paper-label">Address:</span>
          <MedicalInput rec={cycle} field="address" label={t("address")} maxLength={500} />
        </div>
      </div>
      <div className={cn(grid, "items-stretch")}>
        {/* Box 1 */}
        <div className="paper-box col-span-5 space-y-0.5 p-1.5">
          <div className="flex items-baseline gap-1">
            <span className="paper-label">W:</span>
            <MedicalInput rec={cycle} field="wife_name" label={t("wife")} />
            <span className="paper-label">Age</span>
            <MedicalNumberInput rec={cycle} field="wife_age" min={10} max={80} label={t("wifeAge")} className="w-10" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="paper-label">H:</span>
            <MedicalInput rec={cycle} field="husband_name" label={t("husband")} />
            <span className="paper-label">Age</span>
            <MedicalNumberInput rec={cycle} field="husband_age" min={10} max={100} label={t("husbandAge")} className="w-10" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="paper-label">L.M.P.:</span>
            <MedicalDateInput rec={cycle} field="lmp" label="LMP" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="paper-label">Protocol:</span>
            <MedicalSelect rec={cycle} field="protocol" options={protocolOptions} label={t("protocol")} />
          </div>
        </div>
        {/* Box 2 — single choice */}
        <div className="paper-box col-span-4 p-1.5">
          <RadioColumn rec={cycle} field="procedure" options={OI_PROCEDURES} label={t("procedure")} />
        </div>
        {/* Box 3 — multiple choice */}
        <div className="paper-box col-span-4 p-1.5">
          <MedicalCheckboxGroup rec={cycle} field="addons" options={OI_ADDONS} label={t("addons")} />
        </div>
        {/* Box 4 — single choice */}
        <div className="paper-box col-span-4 p-1.5">
          <RadioColumn rec={cycle} field="sperm_retrieval" options={OI_SPERM_RETRIEVAL} label={t("spermRetrieval")} />
        </div>
        {/* Box 5 */}
        <div className="paper-box col-span-8 space-y-0.5 p-1.5">
          <div className="flex items-baseline gap-1">
            <span className="paper-label">Inf.duration:</span>
            <MedicalInput rec={cycle} field="inf_duration" label={t("infDuration")} />
          </div>
          {(["primary", "secondary"] as const).map((type) => (
            <div key={type} className="flex items-baseline gap-1">
              <label className="paper-label inline-flex items-center gap-1">
                <input
                  type="radio"
                  className="paper-check"
                  name="infertility_type"
                  checked={cycle.values.infertility_type === type}
                  disabled={cycle.readOnly}
                  onChange={() => cycle.set("infertility_type", type)}
                  onClick={() => cycle.values.infertility_type === type && cycle.set("infertility_type", null)}
                />
                {type === "primary" ? "Primary:" : "Secondary:"}
              </label>
              <MedicalInput rec={cycle} field={type === "primary" ? "primary_note" : "secondary_note"} label={t(type)} />
            </div>
          ))}
        </div>
        {/* Box 6 */}
        <div className="paper-box col-span-6 space-y-0.5 p-1.5">
          <div className="flex items-baseline gap-1">
            <span className="paper-label">Female F</span>
            <MedicalInput rec={cycle} field="female_factor" label={t("femaleFactor")} />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="paper-label">Male F :</span>
            <MedicalInput rec={cycle} field="male_factor" label={t("maleFactor")} />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="paper-label">Unexplained:</span>
            <MedicalInput rec={cycle} field="unexplained" label={t("unexplained")} />
          </div>
          <MedicalInput rec={cycle} field="extra_note" label={t("extraNote")} />
        </div>
      </div>
    </div>
  )
}

function RadioColumn<T extends FertilityCycle>({
  rec,
  field,
  options,
  label,
}: {
  rec: RecordController<T>
  field: "procedure" | "sperm_retrieval"
  options: readonly { value: string; label: string }[]
  label: string
}) {
  const value = rec.values[field] as string | null
  return (
    <div role="radiogroup" aria-label={label} className="flex h-full flex-col justify-around">
      {options.map((o) => (
        <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            className="paper-check"
            name={field}
            checked={value === o.value}
            disabled={rec.readOnly}
            onChange={() => rec.set(field, o.value as T[typeof field])}
            onClick={() => value === o.value && rec.set(field, null as T[typeof field])}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/** Hormone snapshot rows (imported from latest results; edits never touch lab history). */
function HormoneBlock({ hormones, readOnly, patientId }: { hormones: CycleHormone[]; readOnly: boolean; patientId: string }) {
  return (
    <div className="flex h-full flex-col justify-center gap-0.5 px-1.5 py-2">
      {OI_HORMONES.map((h) => {
        const row = hormones.find((x) => x.hormone_code === h.code)
        return row ? <HormoneLine key={h.code} label={h.label} row={row} readOnly={readOnly} patientId={patientId} /> : null
      })}
    </div>
  )
}

function HormoneLine({ label, row, readOnly, patientId }: { label: string; row: CycleHormone; readOnly: boolean; patientId: string }) {
  const t = useTranslations("oi")
  const rec = useRecord({ table: "fertility_cycle_hormones", keyField: "id", row, readOnly })
  const imported = !!row.source_result_id && rec.values.value === row.source_value
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-baseline gap-1">
      <span className="paper-label">{label}</span>
      <MedicalInput rec={rec} field="value" label={label} imported={imported} maxLength={40} />
      {row.source_date ? (
        <Link
          href={`/patients/${patientId}?tab=investigations`}
          className="no-print text-[9.5px] whitespace-nowrap text-[color:var(--paper-muted)] hover:text-[#2a8a9b]"
          title={`${t("importedFrom", { date: formatDate(row.source_date) })} — ${t("openSource")}`}
        >
          ↧{formatDate(row.source_date).slice(0, 5)}
        </Link>
      ) : (
        <span />
      )}
    </div>
  )
}

/** Day 1 drives Days 2–15; any day can be overridden explicitly. */
function DateRow({ cycleId, initialDays, readOnly }: { cycleId: string; initialDays: CycleDay[]; readOnly: boolean }) {
  const t = useTranslations("oi")
  const reason = useCorrectionReason()
  const { showError } = useActionError()
  const [days, setDays] = useState(initialDays)
  const [confirm, setConfirm] = useState<string | null>(null)
  const byDay = (n: number) => days.find((d) => d.day_number === n)

  useRealtime(`days:${cycleId}`, [{ table: "fertility_cycle_days", filter: `cycle_id=eq.${cycleId}` }], (payload) => {
    const row = payload.new as CycleDay
    if (row?.id) setDays((prev) => prev.map((d) => (d.id === row.id && row.version > d.version ? row : d)))
  })

  const applyDay1 = async (date: string | null) => {
    const res = await setCycleDay1({ cycleId, date, keepOverrides: true, reason })
    if (!res.ok) return showError(res.error)
    // Mirror the server calculation locally (realtime will confirm versions).
    const calc = cycleDates(date, days, true)
    setDays((prev) => prev.map((d) => ({ ...d, ...calc.find((c) => c.day_number === d.day_number)! })))
    toast.success(t("datesUpdated"))
  }

  const onDay1 = (date: string | null) => {
    const others = days.some((d) => d.day_number > 1 && d.cycle_date)
    if (others && byDay(1)?.cycle_date) setConfirm(date ?? "")
    else void applyDay1(date)
  }

  const override = async (day: CycleDay, date: string | null, isOverride: boolean) => {
    const res = await saveRecord({
      table: "fertility_cycle_days",
      key: day.id,
      patch: { cycle_date: date, is_override: isOverride },
      expectedVersion: day.version,
      reason,
    })
    if (!res.ok) return showError(res.error)
    setDays((prev) => prev.map((d) => (d.id === day.id ? (res.data.row as unknown as CycleDay) : d)))
  }

  const day1 = byDay(1)?.cycle_date ?? null
  return (
    <>
      <tr className="h-8">
        <td className="px-1.5">Date</td>
        {DAYS.map((n) => {
          const d = byDay(n)
          if (n === 1) {
            return (
              <td key={n} colSpan={2} className="bg-[color:var(--paper-fill)]/60">
                <Day1Cell value={day1} disabled={readOnly || !d} onCommit={onDay1} />
              </td>
            )
          }
          return (
            <td key={n} colSpan={2} className="relative">
              <DayCell day={d} readOnly={readOnly} day1={day1} onOverride={override} />
            </td>
          )
        })}
      </tr>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("changeDay1Title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("changeDay1Body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const date = confirm || null
                setConfirm(null)
                void applyDay1(date)
              }}
            >
              {t("continue")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Day 1 shows dd/MM like the paper; a date picker opens on click. */
function Day1Cell({ value, disabled, onCommit }: { value: string | null; disabled: boolean; onCommit: (date: string | null) => void }) {
  const t = useTranslations("oi")
  // Shows dd/mm like the paper; type DD/MM/YYYY or pick from the calendar.
  return (
    <DateInput
      variant="cell"
      value={value}
      disabled={disabled}
      aria-label={t("day1Date")}
      className="font-semibold"
      onChange={(v) => {
        if (v !== value) onCommit(v)
      }}
    />
  )
}

function DayCell({
  day,
  readOnly,
  day1,
  onOverride,
}: {
  day: CycleDay | undefined
  readOnly: boolean
  day1: string | null
  onOverride: (day: CycleDay, date: string | null, isOverride: boolean) => void
}) {
  const t = useTranslations("oi")
  if (!day) return null
  return (
    <span className="group flex h-full items-center justify-center gap-0.5" title={day.is_override ? t("overridden") : t("calculated")}>
      <DateInput
        variant="cell"
        value={day.cycle_date}
        disabled={readOnly}
        aria-label={t("dayDate", { day: day.day_number })}
        className={cn(day.is_override && "font-semibold italic")}
        onChange={(v) => {
          if (v && v !== day.cycle_date) onOverride(day, v, true)
        }}
      />
      {day.is_override && !readOnly && day1 && (
        <button
          type="button"
          className="no-print absolute top-0 end-0 hidden text-[color:var(--paper-muted)] group-hover:block"
          onClick={() => {
            const d = new Date(`${day1}T00:00:00Z`)
            d.setUTCDate(d.getUTCDate() + day.day_number - 1)
            onOverride(day, d.toISOString().slice(0, 10), false)
          }}
          aria-label={t("resetDate")}
          title={t("resetDate")}
        >
          <RotateCcw className="size-3" />
        </button>
      )}
    </span>
  )
}
