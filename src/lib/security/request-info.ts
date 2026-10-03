import "server-only"
import { headers } from "next/headers"
import { describeUserAgent } from "./user-agent"

export interface ClientInfo {
  ip: string | null
  userAgent: string
  browser: string
  os: string
  deviceType: "desktop" | "mobile" | "tablet"
}

/**
 * Client IP as reported by the reverse proxy (left-most X-Forwarded-For
 * entry). It is informational (shown in session lists / logs) and used as
 * one rate-limit key among others, never for authorization.
 */
export async function clientInfo(): Promise<ClientInfo> {
  const h = await headers()
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = (forwarded || h.get("x-real-ip") || "").slice(0, 64) || null
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512)
  return { ip, userAgent, ...describeUserAgent(userAgent) }
}
