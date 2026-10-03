import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { Baby, CalendarDays, FlaskConical, HeartPulse, History, ListChecks, Pill, Stethoscope, TestTube2 } from "lucide-react"
import { getSession, hasPermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { formatDate, formatDateTime } from "@/lib/dates"
import { gestationalAge } from "@/lib/medical/calculations"
import type { PatientContext } from "@/lib/data/patient"
import type { InvestigationResult, PatientMedicalHistory, TimelineEvent, Visit } from "@/types/db"
import { SectionCard } from "@/components/common/page"
import { PatientTimeline } from "@/components/patients/patient-timeline"
import { VisitStatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"

export async function OverviewTab({ ctx }: { ctx: PatientContext }) {
  const session = (await getSession())!
  const t = await getTranslations("overview")
  const tv = await getTranslations("visits")
  const locale = await getLocale()
  const can = (c: (typeof P)[keyof typeof P]) => hasPermission(session, c)
  const supabase = await createClient()
  const pid = ctx.patient.id

  const [medical, surgical, meds, visits, upcoming, results, timeline] = await Promise.all([
    can(P.medicalView) ? supabase.from("patient_medical_history").select("*").eq("patient_id", pid).maybeSingle() : null,
    can(P.medicalView) ? supabase.from("patient_surgical_history").select("notes").eq("patient_id", pid).maybeSingle() : null,
    can(P.medicalView) ? supabase.from("patient_medications").select("notes").eq("patient_id", pid).maybeSingle() : null,
    can(P.visitsView) || can(P.visitsViewRecent)
      ? supabase.from("visits").select("*").eq("patient_id", pid).order("started_at", { ascending: false }).limit(5)
      : null,
    can(P.appointmentsView)
      ? supabase
          .from("appointments")
          .select("id, scheduled_at, visit_type, status, doctor:doctors(display_name_en, display_name_ar)")
          .eq("patient_id", pid)
          .gte("scheduled_at", new Date().toISOString())
          .in("status", ["scheduled", "checked_in"])
          .order("scheduled_at")
          .limit(1)
          .maybeSingle()
      : null,
    can(P.investigationsView) ? supabase.rpc("latest_investigation_results", { p_patient: pid, p_codes: null }) : null,
    supabase.from("patient_timeline").select("*").eq("patient_id", pid).order("occurred_at", { ascending: false }).limit(15),
  ])

  const mh = medical?.data as PatientMedicalHistory | null
  const flags = mh ? (["ht", "dm", "hypothyroidism"] as const).filter((k) => mh[k] === true) : []
  const upcomingAppt = upcoming?.data as { id: string; scheduled_at: string; visit_type: string; doctor: { display_name_en: string; display_name_ar: string | null } | null } | null
  const ga = gestationalAge(ctx.activePregnancy?.lmp)

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <SectionCard title={t("activeFertility")} icon={FlaskConical}>
            {ctx.activeFertilityCase ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">{t("caseNumber", { number: ctx.activeFertilityCase.case_number })}</p>
                {ctx.activeCycle ? (
                  <Button size="sm" asChild>
                    <Link href={`/patients/${pid}/cycles/${ctx.activeCycle.id}`}>
                      <HeartPulse />
                      {t("openCycle", { number: ctx.activeCycle.cycle_number })}
                    </Link>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("noActiveCycle")}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            )}
          </SectionCard>
          <SectionCard title={t("activePregnancy")} icon={Baby}>
            {ctx.activePregnancy ? (
              <Link href={`/patients/${pid}/pregnancies/${ctx.activePregnancy.id}`} className="block space-y-1 text-sm hover:text-primary">
                <p className="font-medium">{t("pregnancyNumber", { number: ctx.activePregnancy.case_number })}</p>
                <p className="text-xs text-muted-foreground">
                  {ga ? t("ga", { weeks: ga.weeks, days: ga.days }) : t("noLmp")}
                  {ctx.activePregnancy.edd ? ` · EDD ${formatDate(ctx.activePregnancy.edd)}` : ""}
                </p>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            )}
          </SectionCard>
          <SectionCard title={t("nextAppointment")} icon={CalendarDays}>
            {upcomingAppt ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{formatDateTime(upcomingAppt.scheduled_at, locale)}</p>
                <p className="text-xs text-muted-foreground">
                  {locale === "ar" ? (upcomingAppt.doctor?.display_name_ar ?? upcomingAppt.doctor?.display_name_en) : upcomingAppt.doctor?.display_name_en}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noUpcoming")}</p>
            )}
          </SectionCard>
        </div>

        {medical && (
          <SectionCard
            title={t("medicalSummary")}
            icon={ListChecks}
            actions={
              <Button size="sm" variant="ghost" asChild>
                <Link href={`?tab=medical`}>{t("editHistory")}</Link>
              </Button>
            }
          >
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t("conditions")}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {flags.length ? (
                    flags.map((f) => (
                      <span key={f} className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium">
                        {t(`flag.${f}`)}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
                {mh?.notes && <p className="mt-1 text-xs text-muted-foreground">{mh.notes}</p>}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("surgical")}</dt>
                <dd className="mt-1 whitespace-pre-line">{(surgical?.data as { notes: string | null } | null)?.notes || "—"}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Pill className="size-3" />
                  {t("medications")}
                </dt>
                <dd className="mt-1 whitespace-pre-line">{(meds?.data as { notes: string | null } | null)?.notes || "—"}</dd>
              </div>
            </dl>
          </SectionCard>
        )}

        {visits && (
          <SectionCard
            title={t("recentVisits")}
            icon={Stethoscope}
            actions={
              <Button size="sm" variant="ghost" asChild>
                <Link href="?tab=visits">{t("viewAll")}</Link>
              </Button>
            }
            bodyClassName="p-0"
          >
            {(visits.data as Visit[] | null)?.length ? (
              <ul className="divide-y">
                {(visits.data as Visit[]).map((v) => (
                  <li key={v.id}>
                    <Link href={`/patients/${pid}/visits/${v.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                      <span>
                        <span className="font-medium">{tv(`type.${v.visit_type}`)}</span>
                        <span className="text-muted-foreground"> · {formatDate(v.visit_date)}</span>
                      </span>
                      <VisitStatusBadge status={v.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t("noVisits")}</p>
            )}
          </SectionCard>
        )}

        {results && (
          <SectionCard
            title={t("latestResults")}
            icon={TestTube2}
            actions={
              <Button size="sm" variant="ghost" asChild>
                <Link href="?tab=investigations">{t("viewAll")}</Link>
              </Button>
            }
          >
            {(results.data as InvestigationResult[] | null)?.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(results.data as InvestigationResult[]).map((r) => (
                  <div key={r.id} className="rounded-lg border px-3 py-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase">{r.type_code}</p>
                    <p className="text-lg font-semibold tabular-nums">{r.value_numeric ?? r.value_text}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(r.result_date)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noResults")}</p>
            )}
          </SectionCard>
        )}
      </div>

      <SectionCard
        title={t("timeline")}
        icon={History}
        className="xl:sticky xl:top-[calc(3.5rem+8rem)] xl:self-start"
        actions={
          <Button size="sm" variant="ghost" asChild>
            <Link href="?tab=timeline">{t("viewAll")}</Link>
          </Button>
        }
      >
        <PatientTimeline patientId={pid} events={(timeline.data ?? []) as TimelineEvent[]} compact />
      </SectionCard>
    </div>
  )
}
