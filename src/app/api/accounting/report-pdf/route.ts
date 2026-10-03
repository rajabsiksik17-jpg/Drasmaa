import { NextResponse, type NextRequest } from "next/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { isAccountingReport } from "@/lib/accounting/reports"
import { internalOrigin, renderPdf } from "@/lib/pdf/render"
import { rendererCookies } from "@/lib/pdf/session"
import { limit } from "@/lib/security/rate-limit"

export const maxDuration = 120

/** PDF of a financial report, rendered as the requesting user (not stored). */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || session.state !== "active") return new NextResponse(null, { status: 401 })
  if (!hasPermission(session, P.accountingView)) return new NextResponse(null, { status: 403 })
  const sp = request.nextUrl.searchParams
  const kind = sp.get("kind")
  const from = sp.get("from") ?? ""
  const to = sp.get("to") ?? from
  if (!isAccountingReport(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new NextResponse(null, { status: 400 })
  if (!(await limit("pdfPerUser", session.userId))) return new NextResponse(null, { status: 429 })
  const lang = session.profile.locale === "ar" ? "ar" : "en"
  const cookieJar = await rendererCookies(lang)
  if (!cookieJar) return new NextResponse(null, { status: 401 })
  try {
    const pdf = await renderPdf({
      url: `${internalOrigin()}/print/accounting?${new URLSearchParams({ kind, from, to, lang, pdf: "1" })}`,
      cookies: cookieJar,
      orientation: ["invoices", "payments", "cash_collection", "insurance_collection", "refunds"].includes(kind) ? "landscape" : "portrait",
      margins: { top: 12, right: 10, bottom: 14, left: 10 },
      footer: `${kind} · ${from} - ${to}`,
    })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${kind}_${from}_${to}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error(`[pdf] accounting report failed: ${(e as Error).message}`)
    return new NextResponse(null, { status: 500 })
  }
}
