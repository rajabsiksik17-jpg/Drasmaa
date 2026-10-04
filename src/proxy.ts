import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/env"

const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth", "/api/cron", "/setup"]

/** Strict per-request CSP: scripts only from this origin with this request's nonce. */
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV === "development"
  const supabase = SUPABASE_URL ? new URL(SUPABASE_URL) : null
  const supa = supabase ? `${supabase.origin} ${supabase.protocol === "https:" ? "wss" : "ws"}://${supabase.host}` : ""
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by animation / positioning libraries.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase?.origin ?? ""}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${supa}${dev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`.trim(),
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ")
}

/**
 * Refreshes the Supabase session cookie on every request, performs an
 * optimistic redirect for signed-out users and sets the security headers.
 * Authorization itself is enforced server-side (permission checks, session
 * gate) and in the database (RLS).
 */
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const csp = contentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)
  requestHeaders.delete("x-clinic-locale")
  requestHeaders.delete("x-clinic-render")
  // Print views can be rendered in a chosen document language / PDF mode.
  if (pathname.startsWith("/print/")) {
    const lang = searchParams.get("lang")
    if (lang === "ar" || lang === "en") requestHeaders.set("x-clinic-locale", lang)
    if (searchParams.get("pdf") === "1") requestHeaders.set("x-clinic-render", "pdf")
    else if (searchParams.get("preview") === "1") requestHeaders.set("x-clinic-render", "preview")
  }

  const finish = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp)
    if (process.env.NODE_ENV === "production") {
      response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    }
    return response
  }
  const next = () => NextResponse.next({ request: { headers: requestHeaders } })

  // Development-only visual preview with fictional fixture data (the page
  // itself returns 404 in production builds; nothing there reads real data).
  if (process.env.NODE_ENV === "development" && pathname.startsWith("/dev/")) return finish(next())

  if (!isSupabaseConfigured) {
    if (pathname.startsWith("/setup")) return finish(next())
    return NextResponse.redirect(new URL("/setup", request.url))
  }

  let response = next()
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        // Re-create the forwarded request headers with the refreshed cookies.
        requestHeaders.set("cookie", request.cookies.toString())
        response = next()
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
      },
    },
  })

  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
  }
  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }
  return finish(response)
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|templates/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
