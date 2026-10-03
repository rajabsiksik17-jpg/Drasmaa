import "server-only"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "./env"

/**
 * Supabase client bound to the signed-in user's session (RLS applies).
 *
 * `auditReason` is forwarded as the `x-audit-reason` header; the database
 * audit trigger stores it with every change made by this request and the
 * historical-record guards require it to correct completed records.
 */
export async function createClient(options: { auditReason?: string | null } = {}) {
  const cookieStore = await cookies()
  const headers: Record<string, string> = {}
  if (options.auditReason?.trim()) {
    headers["x-audit-reason"] = Buffer.from(options.auditReason.trim(), "utf8").toString("base64")
  }

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    global: { headers },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options: cookieOptions } of cookiesToSet) {
            cookieStore.set(name, value, cookieOptions)
          }
        } catch {
          // Called from a Server Component: the proxy refreshes sessions.
        }
      },
    },
  })
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>
