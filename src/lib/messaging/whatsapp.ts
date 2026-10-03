// WhatsApp "prepared message" helpers. The application never sends
// WhatsApp messages itself: it builds an official click-to-chat link that
// the user opens explicitly (WhatsApp app / WhatsApp Web).

export type WhatsAppNumberResult = { ok: true; number: string } | { ok: false; reason: "empty" | "invalid" }

/**
 * Normalizes a phone number to international digits without "+".
 * Jordan (default country 962):
 *   0791234567      → 962791234567
 *   791234567       → 962791234567
 *   +962791234567   → 962791234567   (no duplicated 962)
 *   00962791234567  → 962791234567
 *   +9620791234567  → 962791234567   (stray trunk 0 removed)
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined, countryCode = "962"): WhatsAppNumberResult {
  const input = (raw ?? "").trim()
  if (!input) return { ok: false, reason: "empty" }
  const hasPlus = input.startsWith("+")
  let digits = input.replace(/\D/g, "")
  if (!digits) return { ok: false, reason: "empty" }

  if (hasPlus) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2)
  } else if (digits.startsWith(countryCode) && digits.length > countryCode.length + 7) {
    // already has the country code without "+"
  } else if (digits.startsWith("0")) {
    digits = countryCode + digits.replace(/^0+/, "")
  } else {
    digits = countryCode + digits
  }
  // Remove a trunk "0" written after the country code (+962 07…).
  if (digits.startsWith(`${countryCode}0`)) digits = countryCode + digits.slice(countryCode.length + 1)

  if (countryCode === "962" && digits.startsWith("962")) {
    // Jordanian mobiles: 9627[789]XXXXXXX; landlines 962[2-6]XXXXXXX are not on WhatsApp in practice.
    return /^9627[789]\d{7}$/.test(digits) ? { ok: true, number: digits } : { ok: false, reason: "invalid" }
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? { ok: true, number: digits } : { ok: false, reason: "invalid" }
}

export const formatInternational = (n: string) => `+${n}`

export type WhatsAppTarget = "app" | "web" | "universal"

export function whatsappLink(number: string, text: string, target: WhatsAppTarget = "universal"): string {
  const t = encodeURIComponent(text)
  switch (target) {
    case "web":
      return `https://web.whatsapp.com/send?phone=${number}&text=${t}`
    case "app":
      return `whatsapp://send?phone=${number}&text=${t}`
    default:
      return `https://wa.me/${number}?text=${t}`
  }
}

/** Phones/tablets open the app; desktops open WhatsApp Web. */
export function preferredTarget(mode: "auto" | "web" | "app", userAgent: string): WhatsAppTarget {
  if (mode === "web") return "web"
  if (mode === "app") return "universal"
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ? "universal" : "web"
}
