import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { Stethoscope } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { formatDate, formatTime } from "@/lib/dates"
import { EmptyState } from "@/components/common/page"
import { VisitStatusBadge } from "@/components/common/status-badge"
import type { Doctor, Visit } from "@/types/db"

export async function VisitsTab({ patientId }: { patientId: string }) {
  const t = await getTranslations("visits")
  const locale = await getLocale()
  const session = (await getSession())!
  const supabase = await createClient()
  const { data } = await supabase
    .from("visits")
    .select("*, doctor:doctors(display_name_en, display_name_ar)")
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false })
    .limit(200)
  const visits = (data ?? []) as (Visit & { doctor: Pick<Doctor, "display_name_en" | "display_name_ar"> | null })[]
  const restricted = !hasPermission(session, P.visitsView)
  const canOpen = hasPermission(session, P.visitsView)

  if (visits.length === 0) {
    return <EmptyState icon={Stethoscope} title={t("empty")} description={restricted ? t("recentOnly") : undefined} />
  }
  return (
    <div className="space-y-2">
      {restricted && <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t("recentOnly")}</p>}
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("date")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("visitType")}</th>
              <th className="hidden px-4 py-2.5 text-start font-medium sm:table-cell">{t("doctor")}</th>
              <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">{t("formColumn")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => {
              const doctor = v.doctor ? (locale === "ar" ? (v.doctor.display_name_ar ?? v.doctor.display_name_en) : v.doctor.display_name_en) : "—"
              return (
                <tr key={v.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {canOpen ? (
                      <Link href={`/patients/${patientId}/visits/${v.id}`} className="font-medium hover:text-primary hover:underline">
                        {formatDate(v.visit_date)}
                      </Link>
                    ) : (
                      formatDate(v.visit_date)
                    )}
                    <span className="block text-xs text-muted-foreground">{formatTime(v.started_at, locale)}</span>
                  </td>
                  <td className="px-4 py-2.5">{t(`type.${v.visit_type}`)}</td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">{doctor}</td>
                  <td className="hidden px-4 py-2.5 text-xs text-muted-foreground md:table-cell">
                    {v.form_code} v{v.form_version}
                  </td>
                  <td className="px-4 py-2.5">
                    <VisitStatusBadge status={v.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
