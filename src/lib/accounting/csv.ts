/** RFC 4180 CSV with a UTF-8 BOM (opens correctly in Excel, Arabic included). */
export function toCsv(columns: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = typeof v === "number" ? v.toFixed(3) : v
    // Neutralize spreadsheet formulas (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== "number" ? `'${s}` : s
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return "﻿" + [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")
}
