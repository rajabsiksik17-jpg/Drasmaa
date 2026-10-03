import "server-only"
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Server-side secrets handling.
 *
 * APP_ENCRYPTION_KEY (32 random bytes, base64 or hex) is the single master
 * key. Purpose-specific sub-keys are derived with HKDF so the same key is
 * never used for two purposes:
 *   - "credentials": AES-256-GCM encryption of SMTP/IMAP passwords at rest
 *   - "otp":         HMAC of one-time codes (codes are never stored)
 *   - "device":      HMAC of the trusted-device cookie
 */

const VERSION = "v1"

function masterKey(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim()
  if (!raw) return null
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64")
  return buf.length >= 32 ? buf : null
}

export const isEncryptionConfigured = () => masterKey() !== null

function subKey(purpose: "credentials" | "otp" | "device"): Buffer {
  const key = masterKey()
  if (!key) throw new Error("APP_ENCRYPTION_KEY is not configured (32 random bytes, base64).")
  return Buffer.from(hkdfSync("sha256", key, Buffer.from("clinic-emr"), Buffer.from(purpose), 32))
}

/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext> (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", subKey("credentials"), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":")
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(":")
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unsupported secret format.")
  const decipher = createDecipheriv("aes-256-gcm", subKey("credentials"), Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
}

export function hmac(purpose: "otp" | "device", value: string): string {
  return createHmac("sha256", subKey(purpose)).update(value).digest("hex")
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex")
  const bb = Buffer.from(b, "hex")
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb)
}

/** Uniform random numeric code (rejection sampling, no modulo bias). */
export function randomDigits(length: number): string {
  let out = ""
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 250 && out.length < length) out += String(byte % 10)
    }
  }
  return out
}
