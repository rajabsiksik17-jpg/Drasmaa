import { describe, expect, it, vi } from "vitest"
import { normalizeWhatsAppNumber, preferredTarget, whatsappLink } from "@/lib/messaging/whatsapp"
import { renderTemplate, sanitizeSubject, unknownVariables } from "@/lib/messaging/templates"
import { buildFileName } from "@/lib/documents/registry"
import { describeUserAgent } from "@/lib/security/user-agent"

vi.mock("server-only", () => ({}))

describe("WhatsApp numbers (Jordan default)", () => {
  it.each([
    ["0791234567", "962791234567"],
    ["079 123 4567", "962791234567"],
    ["791234567", "962791234567"],
    ["+962791234567", "962791234567"],
    ["+962 79 123 4567", "962791234567"],
    ["00962791234567", "962791234567"],
    ["962791234567", "962791234567"],
    ["+9620791234567", "962791234567"],
    ["0771234567", "962771234567"],
    ["0781234567", "962781234567"],
  ])("%s → %s (no duplicated 962)", (raw, expected) => {
    expect(normalizeWhatsAppNumber(raw)).toEqual({ ok: true, number: expected })
  })

  it("rejects empty, landline and malformed numbers", () => {
    expect(normalizeWhatsAppNumber("")).toEqual({ ok: false, reason: "empty" })
    expect(normalizeWhatsAppNumber(null)).toEqual({ ok: false, reason: "empty" })
    expect(normalizeWhatsAppNumber("065551234").ok).toBe(false)
    expect(normalizeWhatsAppNumber("07912").ok).toBe(false)
    expect(normalizeWhatsAppNumber("0761234567").ok).toBe(false)
  })

  it("accepts other countries in international format", () => {
    expect(normalizeWhatsAppNumber("+971501234567")).toEqual({ ok: true, number: "971501234567" })
    expect(normalizeWhatsAppNumber("+44 7700 900123")).toEqual({ ok: true, number: "447700900123" })
  })

  it("builds encoded links for WhatsApp Web, the app and wa.me", () => {
    const text = "مرحباً سارة\nموعدك 10/10/2026 & 5:00"
    expect(whatsappLink("962791234567", text, "web")).toBe(`https://web.whatsapp.com/send?phone=962791234567&text=${encodeURIComponent(text)}`)
    expect(whatsappLink("962791234567", text, "app")).toMatch(/^whatsapp:\/\/send\?phone=962791234567&text=/)
    expect(whatsappLink("962791234567", text)).toMatch(/^https:\/\/wa\.me\/962791234567\?text=/)
    expect(decodeURIComponent(whatsappLink("962791234567", text).split("text=")[1])).toBe(text)
  })

  it("opens WhatsApp Web on desktops and the app on phones", () => {
    expect(preferredTarget("auto", "Mozilla/5.0 (Windows NT 10.0) Chrome/150")).toBe("web")
    expect(preferredTarget("auto", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile")).toBe("universal")
    expect(preferredTarget("web", "iPhone Mobile")).toBe("web")
  })
})

describe("templates", () => {
  it("replaces known variables (Arabic and English) and keeps unknown ones visible", () => {
    const out = renderTemplate("مرحباً {{patient_name}}، موعدك مع د. {{ doctor_name }} {{unknown_var}}", {
      patient_name: "سارة أحمد",
      doctor_name: "أحمد",
    })
    expect(out).toBe("مرحباً سارة أحمد، موعدك مع د. أحمد {{unknown_var}}")
    expect(renderTemplate("Dear {{patient_first_name}}{{clinic_phone}}", { patient_first_name: "Sara" })).toBe("Dear Sara")
    expect(unknownVariables("{{patient_name}} {{pateint_name}}")).toEqual(["pateint_name"])
  })

  it("keeps email subjects on one line (no header injection)", () => {
    expect(sanitizeSubject("Hello\r\nBcc: evil@example.com")).toBe("Hello Bcc: evil@example.com")
  })
})

describe("generated file names", () => {
  const at = { date: "2026-10-03", time: "19:45" }
  it("follows {patient}_{type}_{YYYY-MM-DD}_{HH-mm}.pdf", () => {
    expect(buildFileName("Sara Ahmad", "pregnancy_followup", at)).toBe("Sara_Ahmad_Pregnancy_Followup_2026-10-03_19-45.pdf")
    expect(buildFileName("Sara Ahmad", "oi_chart", at)).toBe("Sara_Ahmad_OI_Cycle_2026-10-03_19-45.pdf")
  })
  it("keeps Arabic names and removes characters invalid in file names", () => {
    expect(buildFileName("سارة  أحمد", "patient_summary", at)).toBe("سارة_أحمد_Patient_Summary_2026-10-03_19-45.pdf")
    expect(buildFileName('Sara/"Ahmad":*?<>|', "timeline", at)).toBe("SaraAhmad_Timeline_2026-10-03_19-45.pdf")
    expect(buildFileName("   ", "timeline", at)).toBe("Patient_Timeline_2026-10-03_19-45.pdf")
    expect(buildFileName("x".repeat(300), "timeline", at).length).toBeLessThan(120)
  })
})

describe("user agent", () => {
  it("describes common browsers coarsely", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0 Safari/537.36 Edg/150.0")).toEqual({ browser: "Edge", os: "Windows", deviceType: "desktop" })
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toEqual({ browser: "Safari", os: "iOS", deviceType: "mobile" })
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel) Chrome/150 Mobile Safari/537.36").deviceType).toBe("mobile")
  })
})
