import { addDaysIso, clinicToday } from "@/lib/dates"

export type RangeKey = "today" | "yesterday" | "week" | "month" | "custom"

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Clinic-local date range from URL parameters (week starts on Saturday). */
export function resolveRange(params: Record<string, string | string[] | undefined>): { key: RangeKey; from: string; to: string } {
  const today = clinicToday()
  const key = (typeof params.range === "string" ? params.range : "today") as RangeKey
  if (key === "yesterday") {
    const y = addDaysIso(today, -1)
    return { key, from: y, to: y }
  }
  if (key === "week") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay() // 0 = Sunday … 6 = Saturday
    const back = (dow + 1) % 7
    return { key, from: addDaysIso(today, -back), to: today }
  }
  if (key === "month") return { key, from: `${today.slice(0, 8)}01`, to: today }
  if (key === "custom") {
    const from = typeof params.from === "string" && ISO.test(params.from) ? params.from : today
    const to = typeof params.to === "string" && ISO.test(params.to) ? params.to : from
    return from <= to ? { key, from, to } : { key, from: to, to: from }
  }
  return { key: "today", from: today, to: today }
}
