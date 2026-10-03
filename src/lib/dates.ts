import { TZDate } from "@date-fns/tz"
import { addDays, differenceInCalendarDays, differenceInYears, format, parseISO } from "date-fns"
import { arSA, enGB } from "date-fns/locale"

export const CLINIC_TZ = "Asia/Amman"

/** A calendar date (YYYY-MM-DD) as stored in Postgres `date` columns. */
export type IsoDate = string

/** Normalise to a UTC "Z" timestamp (TZDate#toISOString keeps the offset). */
const utcIso = (d: Date) => new Date(d.getTime()).toISOString()

/** UTC ISO instant `days` days before now (for "last N days" queries). */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** Today's calendar date in the clinic timezone. */
export function clinicToday(now: Date = new Date()): IsoDate {
  return format(new TZDate(now, CLINIC_TZ), "yyyy-MM-dd")
}

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  return format(addDays(parseISO(date), days), "yyyy-MM-dd")
}

/** UTC instant bounds of a clinic-local calendar day: [start, end). */
export function clinicDayRange(date: IsoDate): { start: string; end: string } {
  const [y, m, d] = date.split("-").map(Number)
  const start = new TZDate(y, m - 1, d, 0, 0, 0, CLINIC_TZ)
  const end = new TZDate(y, m - 1, d + 1, 0, 0, 0, CLINIC_TZ)
  return { start: utcIso(start), end: utcIso(end) }
}

/** Combine a clinic-local date and HH:mm into a UTC ISO instant. */
export function clinicDateTimeToIso(date: IsoDate, time: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const [hh, mm] = time.split(":").map(Number)
  return utcIso(new TZDate(y, m - 1, d, hh, mm, 0, CLINIC_TZ))
}

/** Split a UTC instant into clinic-local date + time strings. */
export function isoToClinicParts(iso: string): { date: IsoDate; time: string } {
  const z = new TZDate(new Date(iso), CLINIC_TZ)
  return { date: format(z, "yyyy-MM-dd"), time: format(z, "HH:mm") }
}

export function ageFromDob(dob: IsoDate | null | undefined, on: IsoDate = clinicToday()): number | null {
  if (!dob) return null
  const years = differenceInYears(parseISO(on), parseISO(dob))
  return Number.isFinite(years) && years >= 0 ? years : null
}

const dfLocale = (locale: string) => (locale === "ar" ? arSA : enGB)

/** Clinic paper forms use DD/MM/YYYY. */
export function formatDate(date: IsoDate | null | undefined): string {
  if (!date) return ""
  return format(parseISO(date), "dd/MM/yyyy")
}

export function formatDateLong(date: IsoDate | null | undefined, locale = "en"): string {
  if (!date) return ""
  return format(parseISO(date), "dd/MM/yyyy", { locale: dfLocale(locale) })
}

export function formatTime(iso: string | null | undefined, locale = "en"): string {
  if (!iso) return ""
  return format(new TZDate(new Date(iso), CLINIC_TZ), "h:mm a", { locale: dfLocale(locale) })
}

export function formatDateTime(iso: string | null | undefined, locale = "en"): string {
  if (!iso) return ""
  return format(new TZDate(new Date(iso), CLINIC_TZ), "dd/MM/yyyy, h:mm a", { locale: dfLocale(locale) })
}

export function formatWeekday(date: IsoDate, locale = "en"): string {
  return format(parseISO(date), "EEEE dd/MM", { locale: dfLocale(locale) })
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from))
}

// ---------------------------------------------------------------------
// User-facing date entry: DD/MM/YYYY  <->  ISO yyyy-MM-dd (Postgres `date`)
// ---------------------------------------------------------------------
export type DateParseResult =
  | { ok: true; iso: IsoDate }
  | { ok: false; reason: "empty" | "incomplete" | "invalid" }

/**
 * Parses what a user typed or pasted. Accepts D/M/YYYY with "/", ".", "-" or
 * spaces as separators, DDMMYYYY without separators, and ISO yyyy-mm-dd
 * (e.g. pasted from another system). Rejects impossible dates (31/02/2026).
 */
export function parseDisplayDate(input: string): DateParseResult {
  const s = input.trim()
  if (!s) return { ok: false, reason: "empty" }
  let d: number, m: number, y: number
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const sep = s.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/)
  const compact = s.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (sep) [d, m, y] = [Number(sep[1]), Number(sep[2]), Number(sep[3])]
  else if (compact) [d, m, y] = [Number(compact[1]), Number(compact[2]), Number(compact[3])]
  else return { ok: false, reason: /^[\d/.\-\s]+$/.test(s) && s.replace(/\D/g, "").length < 8 ? "incomplete" : "invalid" }
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return { ok: false, reason: "invalid" }
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false, reason: "invalid" } // e.g. 31/02/2026
  }
  return { ok: true, iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` }
}

/** Auto-inserts "/" while typing digits: "03" -> "03/", "03/10" -> "03/10/". */
export function autoSlashDate(previous: string, next: string): string {
  const cleaned = next.replace(/[^\d/.\-\s]/g, "").slice(0, 10)
  const growing = cleaned.length > previous.length
  if (growing && /^\d{2}$/.test(cleaned)) return `${cleaned}/`
  if (growing && /^\d{2}\/\d{2}$/.test(cleaned)) return `${cleaned}/`
  return cleaned
}
