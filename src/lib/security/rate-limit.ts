import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

// Fallback when the service key is unavailable (single instance only).
const memory = new Map<string, { start: number; hits: number }>()

function memoryHit(key: string, limit: number, windowSeconds: number) {
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || now - entry.start > windowSeconds * 1000) {
    memory.set(key, { start: now, hits: 1 })
    return true
  }
  entry.hits++
  return entry.hits <= limit
}

/** Fixed-window limiter shared by all app instances (database-backed). */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: key.slice(0, 200),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    if (error) throw error
    return data === true
  } catch {
    return memoryHit(key, limit, windowSeconds)
  }
}

/** [max requests, window seconds] — sized for normal clinic work, tight enough to stop abuse. */
export const LIMITS = {
  loginPerIp: [30, 600],
  loginPerEmail: [10, 600],
  otpVerify: [15, 600],
  passwordReset: [5, 3600],
  emailSendPerUser: [60, 3600],
  emailTestPerUser: [10, 600],
  patientCreatePerUser: [80, 3600],
  uploadPerUser: [150, 3600],
  pdfPerUser: [80, 3600],
  sensitivePerUser: [30, 600],
} as const satisfies Record<string, readonly [number, number]>

export async function limit(name: keyof typeof LIMITS, subject: string) {
  const [n, w] = LIMITS[name]
  return rateLimit(`${name}:${subject}`, n, w)
}
