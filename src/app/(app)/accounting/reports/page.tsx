import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { BarChart3, Download, FileDown, Printer } from "lucide-react"
import { requirePagePermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { resolveRange } from "@/lib/accounting/ranges"
import { SectionCard } from "@/components/common/page"
import { RangeFilter } from "@/components/accounting/range-filter"
import { Button } from "@/components/ui/button"
import { ACCOUNTING_REPORTS } from "@/lib/accounting/reports"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounting.nav")
  return { title: t("reports") }
}

/** Financial reports: print / PDF / CSV for the chosen period. */
export default async function AccountingReportsPage({ searchParams }: PageProps<"/accounting/reports">) {
  await requirePagePermission(P.accountingView)
  const range = resolveRange(await searchParams)
  const t = await getTranslations("accounting.reports")
  const q = `from=${range.from}&to=${range.to}`
  return (
    <div className="space-y-4">
      <RangeFilter range={range} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ACCOUNTING_REPORTS.map((kind) => (
          <SectionCard key={kind} title={t(`kinds.${kind}.title`)} icon={BarChart3}>
            <p className="mb-3 text-sm text-muted-foreground">{t(`kinds.${kind}.hint`)}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={`/print/accounting?kind=${kind}&${q}&autoprint=1`} target="_blank" rel="noopener">
                  <Printer />
                  {t("print")}
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/accounting/report-pdf?kind=${kind}&${q}`}>
                  <FileDown />
                  PDF
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/accounting/export?kind=${kind}&${q}`}>
                  <Download />
                  CSV
                </a>
              </Button>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  )
}
