import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Clears the local Supabase session cookie for sessions that were revoked
 * or ended elsewhere, then shows the sign-in page with an explanation.
 * POST-free on purpose: it only ever removes the caller's own cookie.
 */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason")
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })
  const url = new URL("/login", request.url)
  if (reason === "revoked" || reason === "signed_out") url.searchParams.set("ended", reason)
  return NextResponse.redirect(url)
}
