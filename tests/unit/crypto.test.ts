import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

describe("server secrets", () => {
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  })

  it("encrypts credentials with AES-256-GCM (random IV, tamper-evident)", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/security/crypto")
    const a = encryptSecret("smtp-password-123")
    const b = encryptSecret("smtp-password-123")
    expect(a).not.toBe(b)
    expect(a).not.toContain("smtp-password")
    expect(decryptSecret(a)).toBe("smtp-password-123")
    const parts = a.split(":")
    parts[3] = Buffer.from("tampered").toString("base64")
    expect(() => decryptSecret(parts.join(":"))).toThrow()
  })

  it("hashes OTP codes per purpose and compares in constant time", async () => {
    const { hmac, safeEqualHex, randomDigits } = await import("@/lib/security/crypto")
    const h = hmac("otp", "challenge:123456")
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toBe(hmac("device", "challenge:123456"))
    expect(safeEqualHex(h, hmac("otp", "challenge:123456"))).toBe(true)
    expect(safeEqualHex(h, hmac("otp", "challenge:123457"))).toBe(false)
    const code = randomDigits(6)
    expect(code).toMatch(/^\d{6}$/)
  })

  it("produces uniformly distributed digits", async () => {
    const { randomDigits } = await import("@/lib/security/crypto")
    const counts = new Array(10).fill(0)
    for (const d of randomDigits(20000)) counts[Number(d)]++
    for (const c of counts) expect(c).toBeGreaterThan(1700)
  })
})
