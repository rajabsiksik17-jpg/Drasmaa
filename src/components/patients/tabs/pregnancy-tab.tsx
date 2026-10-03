import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Baby, ChevronRight } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { formatDate, isoToClinicParts } from "@/lib/dates"
import { gestationalAge } from "@/lib/medical/calculations"
import type { PatientContext } from "@/lib/data/patient"
import type { PregnancyCase } from "@/types/db"
import { EmptyState } from "@/components/common/page"
import { CaseStatusBadge } from "@/components/common/status-badge"
import { NewCaseButton, NewVisitButton } from "@/components/patients/case-actions"

export async function PregnancyTab({ ctx }: { ctx: PatientContext }) {
  const session = (await getSession())!
  const t = await getTranslations("cases")
  const tv = await getTranslations("visits")
  const supabase = await createClient()
  const pid = ctx.patient.id
  const { data } = await supabase
    .from("pregnancy_cases")
    .select("*, followups:pregnancy_followups(count)")
    .eq("patient_id", pid)
    .order("case_number", { ascending: false })
  const cases = (data ?? []) as (PregnancyCase & { followups: { count: number }[] })[]
  const hasActive = cases.some((c) => c.status === "active")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {!hasActive && hasPermission(session, P.pregnancyEdit) && <NewCaseButton patientId={pid} kind="pregnancy" />}
        {hasActive && hasPermission(session, P.visitsCreate) && <NewVisitButton patientId={pid} type="pregnancy" label={tv("newPregnancy")} />}
      </div>
      {cases.length === 0 ? (
        <EmptyState icon={Baby} title={t("noPregnancy")} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {cases.map((c) => {
            const ga = c.status === "active" ? gestationalAge(c.lmp) : null
            return (
              <li key={c.id}>
                <Link
                  href={`/patients/${pid}/pregnancies/${c.id}`}
                  className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition hover:border-primary/40 hover:shadow-sm"
                >
                  <span className="grid size-10 place-items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-300">
                    <Baby className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      {t("pregnancyCase", { number: c.case_number })}
                      <CaseStatusBadge status={c.status} />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("followupCount", { count: c.followups?.[0]?.count ?? 0 })}
                      {c.lmp && ` · LMP ${formatDate(c.lmp)}`}
                      {c.edd && ` · EDD ${formatDate(c.edd)}`}
                      {ga && ` · ${t("ga", { weeks: ga.weeks, days: ga.days })}`}
                    </span>
                    <span className="block text-xs text-muted-foreground">{t("openedOn", { date: formatDate(isoToClinicParts(c.opened_at).date) })}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 rtl:-scale-x-100" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
