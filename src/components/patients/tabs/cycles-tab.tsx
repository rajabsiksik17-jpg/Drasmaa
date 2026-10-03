import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { HeartPulse } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { formatDate, isoToClinicParts } from "@/lib/dates"
import type { PatientContext } from "@/lib/data/patient"
import type { FertilityCycle } from "@/types/db"
import { EmptyState } from "@/components/common/page"
import { CaseStatusBadge } from "@/components/common/status-badge"
import { StartCycleButton } from "@/components/patients/case-actions"

const PROC: Record<string, string> = { tsi: "TSI", iui: "IUI", icsi: "ICSI", frzn_et: "Frzn ET" }

export async function CyclesTab({ ctx }: { ctx: PatientContext }) {
  const session = (await getSession())!
  const t = await getTranslations("cases")
  const supabase = await createClient()
  const pid = ctx.patient.id
  const { data } = await supabase
    .from("fertility_cycles")
    .select("id, cycle_number, status, started_at, completed_at, procedure, protocol, fertility_case:fertility_cases(case_number)")
    .eq("patient_id", pid)
    .order("cycle_number", { ascending: false })
  const cycles = (data ?? []) as unknown as (FertilityCycle & { fertility_case: { case_number: number } | null })[]
  const canStart = hasPermission(session, P.oiEdit) && ctx.activeFertilityCase && !ctx.activeCycle

  return (
    <div className="space-y-4">
      {canStart && (
        <div className="flex justify-end">
          <StartCycleButton patientId={pid} caseId={ctx.activeFertilityCase!.id} />
        </div>
      )}
      {cycles.length === 0 ? (
        <EmptyState icon={HeartPulse} title={t("noCycles")} description={ctx.activeFertilityCase ? undefined : t("noCyclesHint")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t("cycle")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("started")}</th>
                <th className="hidden px-4 py-2.5 text-start font-medium sm:table-cell">{t("procedure")}</th>
                <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">{t("fertilityCaseShort")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/patients/${pid}/cycles/${c.id}`} className="font-medium hover:text-primary hover:underline">
                      {t("cycleNumber", { number: c.cycle_number })}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{formatDate(isoToClinicParts(c.started_at).date)}</td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">{c.procedure ? PROC[c.procedure] : "—"}</td>
                  <td className="hidden px-4 py-2.5 md:table-cell">#{c.fertility_case?.case_number}</td>
                  <td className="px-4 py-2.5">
                    <CaseStatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
