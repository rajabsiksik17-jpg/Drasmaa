import { ExportMenu } from "@/components/documents/export-menu"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { FlaskConical, HeartPulse, Stethoscope } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { formatDate, isoToClinicParts } from "@/lib/dates"
import type { PatientContext } from "@/lib/data/patient"
import type { FertilityCase, FertilityCycle, FertilityVisit, Visit } from "@/types/db"
import { EmptyState, SectionCard } from "@/components/common/page"
import { CaseStatusBadge, VisitStatusBadge } from "@/components/common/status-badge"
import { CloseCaseButton, NewCaseButton, NewVisitButton, StartCycleButton } from "@/components/patients/case-actions"

export async function FertilityTab({ ctx }: { ctx: PatientContext }) {
  const session = (await getSession())!
  const t = await getTranslations("cases")
  const tv = await getTranslations("visits")
  const supabase = await createClient()
  const pid = ctx.patient.id
  const [cases, visits, cycles] = await Promise.all([
    supabase.from("fertility_cases").select("*").eq("patient_id", pid).order("case_number", { ascending: false }),
    supabase
      .from("visits")
      .select("*, fertility:fertility_visits(plan_primary, plan_secondary)")
      .eq("patient_id", pid)
      .eq("visit_type", "fertility")
      .order("started_at", { ascending: false }),
    supabase.from("fertility_cycles").select("id, fertility_case_id, cycle_number, status, started_at, procedure").eq("patient_id", pid).order("cycle_number", { ascending: false }),
  ])
  const list = (cases.data ?? []) as FertilityCase[]
  const can = (c: (typeof P)[keyof typeof P]) => hasPermission(session, c)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {can(P.fertilityEdit) && <NewCaseButton patientId={pid} kind="fertility" />}
        {can(P.visitsCreate) && <NewVisitButton patientId={pid} type="fertility" label={tv("newFertility")} />}
      </div>
      {list.length === 0 ? (
        <EmptyState icon={FlaskConical} title={t("noFertility")} description={t("noFertilityHint")} />
      ) : (
        list.map((c) => {
          const caseVisits = ((visits.data ?? []) as (Visit & { fertility: Pick<FertilityVisit, "plan_primary" | "plan_secondary"> | null })[]).filter(
            (v) => v.fertility_case_id === c.id,
          )
          const caseCycles = ((cycles.data ?? []) as FertilityCycle[]).filter((x) => x.fertility_case_id === c.id)
          const active = caseCycles.find((x) => x.status === "active")
          return (
            <SectionCard
              key={c.id}
              title={
                <span className="flex items-center gap-2">
                  {t("fertilityCase", { number: c.case_number })}
                  <CaseStatusBadge status={c.status} />
                </span>
              }
              icon={FlaskConical}
              actions={
                <>
                  <ExportMenu target={{ type: "fertility_summary", entityId: c.id, patientId: pid }} />
                  {c.status === "active" && can(P.fertilityEdit) && (
                    <>
                      {!active && can(P.oiEdit) && <StartCycleButton patientId={pid} caseId={c.id} />}
                      <CloseCaseButton caseId={c.id} kind="fertility" />
                    </>
                  )}
                </>
              }
            >
              <p className="mb-3 text-xs text-muted-foreground">
                {t("openedOn", { date: formatDate(isoToClinicParts(c.opened_at).date) })}
                {c.closed_at && ` · ${t("closedOn", { date: formatDate(isoToClinicParts(c.closed_at).date) })}`}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
                    <Stethoscope className="size-3.5" />
                    {t("visits")}
                  </h3>
                  {caseVisits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {caseVisits.map((v) => (
                        <li key={v.id}>
                          <Link href={`/patients/${pid}/visits/${v.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                            <span>
                              {formatDate(v.visit_date)}
                              {v.fertility?.plan_primary && (
                                <span className="ms-2 rounded bg-primary/10 px-1.5 text-xs font-medium text-primary uppercase">
                                  {v.fertility.plan_primary === "oi" ? "O/I" : v.fertility.plan_primary}
                                </span>
                              )}
                            </span>
                            <VisitStatusBadge status={v.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
                    <HeartPulse className="size-3.5" />
                    {t("cycles")}
                  </h3>
                  {caseCycles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {caseCycles.map((x) => (
                        <li key={x.id}>
                          <Link href={`/patients/${pid}/cycles/${x.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                            <span>
                              {t("cycleNumber", { number: x.cycle_number })}
                              <span className="text-muted-foreground"> · {formatDate(isoToClinicParts(x.started_at).date)}</span>
                            </span>
                            <CaseStatusBadge status={x.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </SectionCard>
          )
        })
      )}
    </div>
  )
}
