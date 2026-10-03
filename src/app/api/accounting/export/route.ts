import { NextResponse, type NextRequest } from "next/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { buildAccountingReport, isAccountingReport, toCsv } from "@/lib/accounting/reports"

/** CSV export of a financial report (accounting.view, RLS applies). */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || session.state !== "active") return new NextResponse(null, { status: 401 })
  if (!hasPermission(session, P.accountingView)) return new NextResponse(null, { status: 403 })
  const sp = request.nextUrl.searchParams
  const kind = sp.get("kind")
  const from = sp.get("from") ?? ""
  const to = sp.get("to") ?? from
  if (!isAccountingReport(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return new NextResponse(null, { status: 400 })
  }
  try {
    const table = await buildAccountingReport(kind, from, to, session.profile.locale === "ar" ? "ar" : "en")
    return new NextResponse(toCsv(table.columns, table.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${kind}_${from}_${to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error(`[accounting] export failed: ${(e as Error).message}`)
    return new NextResponse(null, { status: 500 })
  }
}
