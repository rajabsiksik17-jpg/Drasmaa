import "server-only"
import { createClient } from "@supabase/supabase-js"
import { SUPABASE_URL } from "./env"

/**
 * Service-role client. Bypasses RLS — only used for operations that the
 * Auth admin API requires (creating users) or for trusted background jobs,
 * and always after an explicit server-side permission check.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.")
  }
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
