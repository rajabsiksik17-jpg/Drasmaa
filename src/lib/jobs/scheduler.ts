import "server-only"
import { runJobs } from "./worker"

const INTERVAL_MS = 60_000
let started = false
let running = false

/**
 * In-process scheduler for long-running Node hosts (e.g. `npm start` on a
 * VPS / Hostinger Node.js app). Each tick is idempotent and claims work
 * atomically, so several instances or an extra external cron
 * (/api/cron/reminders) never double-send.
 */
export function startScheduler() {
  if (started) return
  if (process.env.JOBS_ENABLED === "false") return
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) {
    console.warn("[jobs] scheduler disabled: SUPABASE_SERVICE_ROLE_KEY is not configured.")
    return
  }
  started = true
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runJobs()
    } catch (e) {
      console.error(`[jobs] tick failed: ${(e as Error).message}`)
    } finally {
      running = false
    }
  }
  setTimeout(() => void tick(), 15_000)
  setInterval(() => void tick(), INTERVAL_MS).unref?.()
  console.info("[jobs] scheduler started (every 60 s)")
}
