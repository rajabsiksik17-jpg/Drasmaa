import { addDaysIso, clinicToday, daysBetween, type IsoDate } from "@/lib/dates"

/**
 * Pure calculations that the forms display as *system-calculated* values.
 * They organise information; they never interpret it clinically.
 */

export const DEFAULT_CYCLE_FREQUENCY = 28

export interface LmpSummary {
  daysSinceLmp: number | null
  expectedNextCycle: IsoDate | null
  cycleDay: number | null
}

export function lmpSummary(
  lmp: IsoDate | null | undefined,
  cycleFrequency: number | null | undefined,
  today: IsoDate = clinicToday(),
): LmpSummary {
  if (!lmp) return { daysSinceLmp: null, expectedNextCycle: null, cycleDay: null }
  const frequency = cycleFrequency && cycleFrequency > 0 ? cycleFrequency : DEFAULT_CYCLE_FREQUENCY
  const days = daysBetween(lmp, today)
  if (days < 0) return { daysSinceLmp: days, expectedNextCycle: addDaysIso(lmp, frequency), cycleDay: null }
  // Next expected start strictly after today.
  const cyclesElapsed = Math.floor(days / frequency) + 1
  return {
    daysSinceLmp: days,
    expectedNextCycle: addDaysIso(lmp, cyclesElapsed * frequency),
    cycleDay: (days % frequency) + 1,
  }
}

/** Naegele's rule: LMP + 280 days (shown as a calculated date only). */
export function eddFromLmp(lmp: IsoDate | null | undefined): IsoDate | null {
  return lmp ? addDaysIso(lmp, 280) : null
}

/** Gestational age in completed weeks + days from LMP. */
export function gestationalAge(
  lmp: IsoDate | null | undefined,
  on: IsoDate = clinicToday(),
): { weeks: number; days: number } | null {
  if (!lmp) return null
  const total = daysBetween(lmp, on)
  if (total < 0 || total > 320) return null
  return { weeks: Math.floor(total / 7), days: total % 7 }
}

export const OI_DAYS = 15

/**
 * Sequential O/I cycle dates from Day 1. Manually overridden days keep
 * their value when `keepOverrides` is true (mirrors set_cycle_day1 in SQL).
 */
export function cycleDates(
  day1: IsoDate | null,
  existing: { day_number: number; cycle_date: IsoDate | null; is_override: boolean }[] = [],
  keepOverrides = true,
): { day_number: number; cycle_date: IsoDate | null; is_override: boolean }[] {
  return Array.from({ length: OI_DAYS }, (_, i) => {
    const day = i + 1
    const current = existing.find((d) => d.day_number === day)
    if (day > 1 && keepOverrides && current?.is_override) return current
    return { day_number: day, cycle_date: day1 ? addDaysIso(day1, i) : null, is_override: false }
  })
}

export function formatBp(systolic: number | null | undefined, diastolic: number | null | undefined): string {
  if (systolic == null && diastolic == null) return ""
  return `${systolic ?? "—"}/${diastolic ?? "—"}`
}

/** Parse "120/80" (also tolerates spaces, "\" or "-") into numbers. */
export function parseBp(input: string): { systolic: number | null; diastolic: number | null } | null {
  const trimmed = input.trim()
  if (!trimmed) return { systolic: null, diastolic: null }
  const m = trimmed.match(/^(\d{2,3})\s*[/\\-]\s*(\d{2,3})$/)
  if (!m) return null
  return { systolic: Number(m[1]), diastolic: Number(m[2]) }
}
