"use client"

import { useRouter } from "next/navigation"
import { useDebouncedCallback, useRealtime, type RealtimeSpec } from "@/lib/realtime/use-realtime"

/**
 * Re-renders the surrounding Server Components whenever any of the
 * scoped tables change — the database stays the single source of truth.
 */
export function RealtimeRefresh({ channel, specs, delay = 400 }: { channel: string; specs: RealtimeSpec[]; delay?: number }) {
  const router = useRouter()
  const refresh = useDebouncedCallback(() => router.refresh(), delay)
  useRealtime(channel, specs, () => refresh())
  return null
}
