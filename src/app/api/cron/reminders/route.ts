import { NextResponse, type NextRequest } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { runJobs } from "@/lib/jobs/worker"

/**
 * Runs all background jobs once (reminders, email outbox, retention).
 * The app server already runs them every minute; this endpoint is for
 * hosts where an external scheduler is preferred. Idempotent.
 *   GET /api/cron/reminders  with  Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret ?? ""}`
  const authorized =
    !!secret && header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    return NextResponse.json(await runJobs())
  } catch (e) {
    console.error(`[cron] jobs failed: ${(e as Error).message}`)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
