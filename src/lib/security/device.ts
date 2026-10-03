import "server-only"
import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { hmac, isEncryptionConfigured } from "./crypto"

const DEVICE_COOKIE = "clinic_device"

/**
 * Random per-browser identifier (httpOnly, never readable by scripts).
 * Only its HMAC is stored server-side, so a database leak cannot be used
 * to impersonate a trusted device.
 */
export async function deviceHash(create: boolean): Promise<string | null> {
  if (!isEncryptionConfigured()) return null
  const store = await cookies()
  let token = store.get(DEVICE_COOKIE)?.value
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (!create) return null
    token = randomBytes(32).toString("base64url")
    store.set(DEVICE_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
    })
  }
  return hmac("device", token)
}
