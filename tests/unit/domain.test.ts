import { describe, expect, it } from "vitest"
import { ageFromDob, clinicDateTimeToIso, clinicDayRange, clinicToday, isoToClinicParts } from "@/lib/dates"
import { cycleDates, eddFromLmp, formatBp, gestationalAge, lmpSummary, parseBp } from "@/lib/medical/calculations"
import { mapDbError } from "@/lib/errors"
import { checkFile } from "@/lib/storage/files"
import { parsePatch } from "@/lib/validation/record-schemas"
import { FOLLICLE_DAYS, FOLLICLE_ROWS, OI_HORMONES, OI_MEDICATIONS } from "@/lib/medical/oi"

describe("clinic dates (Asia/Amman, UTC+3)", () => {
  it("computes the clinic-local day around midnight", () => {
    // 22:30 UTC on 2 Oct is already 3 Oct in Amman.
    expect(clinicToday(new Date("2026-10-02T22:30:00Z"))).toBe("2026-10-03")
    expect(clinicToday(new Date("2026-10-02T20:59:00Z"))).toBe("2026-10-02")
  })
  it("maps local day ranges and times to UTC instants", () => {
    expect(clinicDayRange("2026-10-03")).toEqual({ start: "2026-10-02T21:00:00.000Z", end: "2026-10-03T21:00:00.000Z" })
    expect(clinicDateTimeToIso("2026-10-03", "10:30")).toBe("2026-10-03T07:30:00.000Z")
    expect(isoToClinicParts("2026-10-03T07:30:00.000Z")).toEqual({ date: "2026-10-03", time: "10:30" })
  })
  it("derives age from date of birth", () => {
    expect(ageFromDob("1994-06-14", "2026-10-03")).toBe(32)
    expect(ageFromDob("1994-10-04", "2026-10-03")).toBe(31)
    expect(ageFromDob(null)).toBeNull()
  })
})

describe("menstrual / pregnancy calculations", () => {
  it("summarises LMP with the configured cycle frequency", () => {
    expect(lmpSummary("2026-09-20", 28, "2026-10-03")).toEqual({ daysSinceLmp: 13, expectedNextCycle: "2026-10-18", cycleDay: 14 })
    expect(lmpSummary("2026-08-01", 30, "2026-10-03").expectedNextCycle).toBe("2026-10-30")
    expect(lmpSummary(null, 28)).toEqual({ daysSinceLmp: null, expectedNextCycle: null, cycleDay: null })
  })
  it("calculates EDD and gestational age", () => {
    expect(eddFromLmp("2026-01-01")).toBe("2026-10-08")
    expect(gestationalAge("2026-07-01", "2026-10-03")).toEqual({ weeks: 13, days: 3 })
  })
  it("parses and formats blood pressure", () => {
    expect(parseBp("120/80")).toEqual({ systolic: 120, diastolic: 80 })
    expect(parseBp(" 110 - 70 ")).toEqual({ systolic: 110, diastolic: 70 })
    expect(parseBp("abc")).toBeNull()
    expect(parseBp("")).toEqual({ systolic: null, diastolic: null })
    expect(formatBp(120, 80)).toBe("120/80")
  })
})

describe("O/I chart", () => {
  it("keeps the paper structure", () => {
    expect(OI_MEDICATIONS.map((m) => m.label)).toEqual(["GnRH-agon", "GnRH-antag", "HMG", "FSH", "Rec.FSH", "C.C/Letrz", "Estrolem"])
    expect(OI_HORMONES.map((h) => h.label)).toEqual(["AMH", "FSH", "LH", "E2", "P4", "Prolactin", "TSH"])
    expect(FOLLICLE_DAYS).toHaveLength(14) // days 2–15 → 28 R/L columns
    expect(FOLLICLE_ROWS).toBeGreaterThanOrEqual(10)
  })
  it("fills days 2–15 from day 1 and keeps manual overrides", () => {
    const days = cycleDates("2026-10-03")
    expect(days).toHaveLength(15)
    expect(days[1].cycle_date).toBe("2026-10-04")
    expect(days[14].cycle_date).toBe("2026-10-17")
    const withOverride = cycleDates("2026-10-05", [{ day_number: 9, cycle_date: "2026-10-20", is_override: true }])
    expect(withOverride[8]).toEqual({ day_number: 9, cycle_date: "2026-10-20", is_override: true })
    expect(withOverride[9].cycle_date).toBe("2026-10-14")
    expect(cycleDates("2026-10-05", [{ day_number: 9, cycle_date: "2026-10-20", is_override: true }], false)[8].cycle_date).toBe("2026-10-13")
  })
})

describe("error mapping (no raw database errors for users)", () => {
  it("translates Postgres errors into stable codes", () => {
    expect(mapDbError({ code: "23P01" })).toEqual({ code: "doubleBooking" })
    expect(mapDbError({ code: "23505" })).toEqual({ code: "duplicate" })
    expect(mapDbError({ code: "42501" })).toEqual({ code: "forbidden" })
    expect(mapDbError({ code: "P0001", hint: "REASON_REQUIRED" })).toEqual({ code: "reasonRequired" })
    expect(mapDbError({ code: "P0001", hint: "MISSING_FIELDS", details: "blood_pressure,followup_date" })).toEqual({
      code: "missingFields",
      fields: ["blood_pressure", "followup_date"],
    })
    expect(mapDbError({ code: "XX000" })).toEqual({ code: "unexpected" })
  })
})

describe("upload validation", () => {
  it("requires matching MIME type and extension within the size limit", () => {
    expect(checkFile({ name: "sfa.pdf", type: "application/pdf", size: 1000 })).toEqual({ ok: true, ext: "pdf" })
    expect(checkFile({ name: "scan.JPG", type: "image/jpeg", size: 1000 })).toEqual({ ok: true, ext: "jpg" })
    expect(checkFile({ name: "evil.exe", type: "application/pdf", size: 1000 })).toEqual({ ok: false, code: "fileType" })
    expect(checkFile({ name: "a.pdf", type: "application/x-msdownload", size: 1000 })).toEqual({ ok: false, code: "fileType" })
    expect(checkFile({ name: "big.pdf", type: "application/pdf", size: 21 * 1024 * 1024 }, 20)).toEqual({ ok: false, code: "fileTooLarge" })
  })
})

describe("record save whitelist", () => {
  it("rejects unknown or protected fields", () => {
    expect(parsePatch("patients", { patient_code: "PAT-999999" }).success).toBe(false)
    expect(parsePatch("patients", { created_by: "x" }).success).toBe(false)
    expect(parsePatch("patient_allergies", { allergy: "Penicillin" }).success).toBe(true)
  })
  it("normalises blank text to null and validates ranges", () => {
    const r = parsePatch("patient_medical_history", { notes: "   " })
    expect(r.success && r.data).toEqual({ notes: null })
    expect(parsePatch("pregnancy_followups", { bp_systolic: 500 }).success).toBe(false)
    expect(parsePatch("fertility_cycles", { addons: ["bc", "imsi"] }).success).toBe(true)
    expect(parsePatch("fertility_cycles", { addons: ["laser"] }).success).toBe(false)
  })
})

describe("DD/MM/YYYY date entry", () => {
  it("parses typed and pasted dates as day-first", async () => {
    const { parseDisplayDate } = await import("@/lib/dates")
    expect(parseDisplayDate("03/10/2026")).toEqual({ ok: true, iso: "2026-10-03" }) // 3 October, not March 10
    expect(parseDisplayDate("3/10/2026")).toEqual({ ok: true, iso: "2026-10-03" })
    expect(parseDisplayDate("03.10.2026")).toEqual({ ok: true, iso: "2026-10-03" })
    expect(parseDisplayDate("03102026")).toEqual({ ok: true, iso: "2026-10-03" })
    expect(parseDisplayDate("2026-10-03")).toEqual({ ok: true, iso: "2026-10-03" })
    expect(parseDisplayDate("29/02/2028")).toEqual({ ok: true, iso: "2028-02-29" })
  })
  it("rejects impossible or incomplete dates", async () => {
    const { parseDisplayDate } = await import("@/lib/dates")
    for (const bad of ["32/10/2026", "31/02/2026", "99/99/9999", "29/02/2026", "00/10/2026", "abc"]) {
      expect(parseDisplayDate(bad)).toEqual({ ok: false, reason: "invalid" })
    }
    expect(parseDisplayDate("03/10")).toEqual({ ok: false, reason: "incomplete" })
    expect(parseDisplayDate("")).toEqual({ ok: false, reason: "empty" })
  })
  it("inserts separators while typing and formats for display", async () => {
    const { autoSlashDate, formatDate } = await import("@/lib/dates")
    expect(autoSlashDate("0", "03")).toBe("03/")
    expect(autoSlashDate("03/1", "03/10")).toBe("03/10/")
    expect(autoSlashDate("03/", "03")).toBe("03") // deleting is not fought
    expect(formatDate("2026-10-03")).toBe("03/10/2026") // no timezone day-shift for DATE values
  })
})
