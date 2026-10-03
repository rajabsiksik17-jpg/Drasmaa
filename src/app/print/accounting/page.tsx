import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { formatDate } from "@/lib/dates"
import { buildAccountingReport, isAccountingReport } from "@/lib/accounting/reports"
import { SUPABASE_URL } from "@/lib/supabase/env"
import { moneyText } from "@/components/documents/money-print"

/** Financial report (print / PDF). Uses the clinic header from Clinic settings. */
export default async function AccountingReportPrint({ searchParams }: PageProps<"/print/accounting">) {
  await requirePagePermission(P.accountingView)
  const sp = await searchParams
  const kind = sp.kind
  const from = typeof sp.from === "string" ? sp.from : ""
  const to = typeof sp.to === "string" ? sp.to : from
  if (!isAccountingReport(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) notFound()
  const locale = await getLocale()
  const lang = locale === "ar" ? "ar" : "en"
  const [table, t, supabase] = await Promise.all([buildAccountingReport(kind, from, to, lang), getTranslations("accounting.reports"), createClient()])
  const { data: clinic } = await supabase.from("clinic_settings").select("clinic_name_en, clinic_name_ar, logo_path, currency").eq("id", 1).single()
  const currency = clinic?.currency ?? "JOD"
  const totals = table.money.map((i) => table.rows.reduce((s, r) => s + (typeof r[i] === "number" ? (r[i] as number) : 0), 0))
  const label = (col: string) => (t.has(`columns.${col}`) ? t(`columns.${col}`) : col)
  const value = (v: string | number, i: number) => {
    if (typeof v === "number" && table.money.includes(i)) return <span dir="ltr">{moneyText(v, currency, locale)}</span>
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v)
    if (typeof v === "string" && t.has(`values.${v}`)) return t(`values.${v}`)
    return v
  }
  return (
    <article className="mx-auto max-w-[210mm] bg-white px-8 py-7 text-[12px] text-black print:px-0 print:py-0" dir={lang === "ar" ? "rtl" : "ltr"}>
      <header className="mb-4 flex items-end justify-between border-b-2 border-black/80 pb-3">
        <div className="flex items-center gap-3">
          {clinic?.logo_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${SUPABASE_URL}/storage/v1/object/public/clinic-assets/${clinic.logo_path}`} alt="" className="h-12 w-auto" />
          )}
          <p className="text-[15px] font-bold">{lang === "ar" ? clinic?.clinic_name_ar : clinic?.clinic_name_en}</p>
        </div>
        <div className="text-end">
          <h1 className="text-[16px] font-bold">{t(`kinds.${kind}.title`)}</h1>
          <p>
            {formatDate(from)}
            {to !== from && ` – ${formatDate(to)}`}
          </p>
        </div>
      </header>
      <table className="w-full border-collapse">
        <thead style={{ display: "table-header-group" }}>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} className={`border border-black/50 bg-black/[0.06] px-1.5 py-1 font-semibold ${table.money.includes(i) ? "text-end" : "text-start"}`}>
                {label(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri} style={{ breakInside: "avoid" }}>
              {r.map((v, i) => (
                <td key={i} className={`border border-black/40 px-1.5 py-1 ${table.money.includes(i) ? "text-end" : ""}`}>
                  {value(v, i)}
                </td>
              ))}
            </tr>
          ))}
          {table.rows.length === 0 && (
            <tr>
              <td colSpan={table.columns.length} className="border border-black/40 px-2 py-4 text-center">
                {t("empty")}
              </td>
            </tr>
          )}
        </tbody>
        {table.rows.length > 0 && table.money.length > 0 && (
          <tfoot style={{ display: "table-footer-group" }}>
            <tr className="font-bold">
              {table.columns.map((c, i) => {
                const k = table.money.indexOf(i)
                return (
                  <td key={c} className={`border border-black/50 px-1.5 py-1 ${k >= 0 ? "text-end" : ""}`}>
                    {k >= 0 ? <span dir="ltr">{moneyText(totals[k], currency, locale)}</span> : i === 0 ? t("total") : ""}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </article>
  )
}
