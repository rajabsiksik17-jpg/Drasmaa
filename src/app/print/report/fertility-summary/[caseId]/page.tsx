import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { KeyValues, ReportDocument, ReportSection, ReportTable, formatDate, loadDoctor, loadReportPatient } from "@/components/documents/report"
import { messageDate } from "@/lib/messaging/variables"

export default async function FertilitySummaryReport({ params }: PageProps<"/print/report/fertility-summary/[caseId]">) {
  const session = await requirePagePermission(P.fertilityView)
  const { caseId } = await params
  if (!/^[0-9a-f-]{36}$/.test(caseId)) notFound()
  const supabase = await createClient()
  const { data: fcase } = await supabase.from("fertility_cases").select("*").eq("id", caseId).maybeSingle()
  if (!fcase) notFound()
  const canOi = hasPermission(session, P.oiView)
  const [patient, { data: visits }, cycles, t, tt, locale] = await Promise.all([
    loadReportPatient(fcase.patient_id),
    supabase
      .from("fertility_visits")
      .select("causes_of_infertility, plan_primary, plan_secondary, plan_notes, notes, visits!inner(visit_date, status, doctor_id)")
      .eq("fertility_case_id", caseId)
      .neq("visits.status", "cancelled"),
    canOi
      ? supabase.from("fertility_cycles").select("cycle_number, status, procedure, protocol, started_at, completed_at").eq("fertility_case_id", caseId).order("cycle_number").then((r) => r.data ?? [])
      : Promise.resolve(null),
    getTranslations("reports"),
    getTranslations("timeline"),
    getLocale(),
  ])
  if (!patient) notFound()
  void locale
  const visitRows = ((visits ?? []) as unknown as {
    causes_of_infertility: string | null
    plan_primary: string | null
    plan_secondary: string | null
    plan_notes: string | null
    notes: string | null
    visits: { visit_date: string; status: string; doctor_id: string | null }
  }[]).sort((a, b) => a.visits.visit_date.localeCompare(b.visits.visit_date))
  const latest = visitRows.at(-1)
  const doctor = await loadDoctor(latest?.visits.doctor_id ?? patient.assigned_doctor_id)
  const plan = (p: string | null) => (p ? p.toUpperCase() : null)

  return (
    <ReportDocument type="fertility_summary" patient={patient} doctor={doctor} subtitle={t("fertilityCase", { number: fcase.case_number })}>
      <ReportSection title={t("sections.fertility")}>
        <KeyValues
          items={[
            [t("fields.status"), tt.has(`status.${fcase.status}`) ? tt(`status.${fcase.status}`) : fcase.status],
            [t("fields.infertilityType"), fcase.infertility_type ? t(`infertility.${fcase.infertility_type}`) : null],
            [t("fields.duration"), fcase.duration_years != null ? t("years", { n: Number(fcase.duration_years) }) : null],
            [t("fields.opened"), messageDate(fcase.opened_at)],
            [t("fields.notes"), fcase.notes],
            [t("fields.causes"), latest?.causes_of_infertility],
            [t("fields.plan"), [plan(latest?.plan_primary ?? null), plan(latest?.plan_secondary ?? null)].filter(Boolean).join(" → ") || null],
            [t("fields.planNotes"), latest?.plan_notes],
          ]}
        />
      </ReportSection>
      <ReportSection title={t("sections.visits")}>
        <ReportTable
          head={[t("fields.date"), t("fields.causes"), t("fields.plan"), t("fields.notes")]}
          rows={visitRows.map((v) => [formatDate(v.visits.visit_date), v.causes_of_infertility ?? "", [plan(v.plan_primary), plan(v.plan_secondary)].filter(Boolean).join(" → "), [v.plan_notes, v.notes].filter(Boolean).join("\n")])}
          empty={t("none")}
        />
      </ReportSection>
      {cycles && (
        <ReportSection title={t("cycles")}>
          <ReportTable
            head={["#", t("fields.procedure"), t("fields.protocol"), t("fields.started"), t("fields.status")]}
            rows={cycles.map((c) => [String(c.cycle_number), c.procedure ? c.procedure.toUpperCase().replace("_", " ") : "—", c.protocol ?? "—", messageDate(c.started_at), tt.has(`status.${c.status}`) ? tt(`status.${c.status}`) : c.status])}
            empty={t("none")}
          />
        </ReportSection>
      )}
    </ReportDocument>
  )
}
