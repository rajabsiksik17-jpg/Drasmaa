import "server-only"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@/lib/supabase/server"
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "@/lib/supabase/env"

/**
 * Cookies for the headless renderer: the user's own session (so RLS and
 * every permission check apply exactly as for the user), but with a dummy
 * refresh token so the renderer can never rotate the user's real session.
 */
export async function rendererCookies(language: "ar" | "en") {
  const supabase = await createClient()
  let { data } = await supabase.auth.getSession()
  if (!data.session) return null
  if ((data.session.expires_at ?? 0) * 1000 - Date.now() < 3 * 60_000) {
    const refreshed = await supabase.auth.refreshSession()
    if (!refreshed.data.session) return null
    data = { session: refreshed.data.session }
  }
  const jar: { name: string; value: string }[] = []
  const temp = createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (list) => {
        for (const c of list) if (c.value) jar.push({ name: c.name, value: c.value })
      },
    },
    auth: { autoRefreshToken: false },
  })
  const { error } = await temp.auth.setSession({ access_token: data.session.access_token, refresh_token: "pdf-renderer-no-refresh" })
  // Cookies are flushed by an auth-state listener; let it run.
  await new Promise((r) => setTimeout(r, 0))
  if (error || jar.length === 0) return null
  jar.push({ name: "NEXT_LOCALE", value: language })
  const device = (await cookies()).get("clinic_device")
  if (device) jar.push({ name: device.name, value: device.value })
  return jar
}

