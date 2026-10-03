"use client"

import { createBrowserClient } from "@supabase/ssr"
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "./env"

let client: ReturnType<typeof createBrowserClient> | undefined

/** Browser client — used for Realtime subscriptions and storage uploads. */
export function getBrowserClient() {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY)
  return client
}
