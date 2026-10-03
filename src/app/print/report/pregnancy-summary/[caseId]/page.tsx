import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { KeyValues, ReportDocument, ReportSection, ReportTable, formatDate, loadDoctor, loadReportPatient } from "@/components/documents/report"
import { messageDate } from "@/lib/messaging/variables"

export default async function PregnancySummaryReport({ params }: PageProps<"/print/report/pregnancy-summary/[caseId]">) {
  await requirePagePermission(P.pregnancyView)
  const { caseId } = await params
  if (!/^[0-9a-f-]{36}$/.test(caseId)) notFound()
  const supabase = await createClient()
  const { data: pcase } = await supabase.from("pregnancy_cases").select("*").eq("id", caseId).maybeSingle()
  if (!pcase) notFound()
  const [patient, { data: followups }, t, tt] = await Promise.all([
    loadReportPatient(pcase.patient_id),
    supabase.from("pregnancy_followups").select("*").eq("pregnancy_case_id", caseId).order("visit_no"),
    getTranslations("reports"),
    getTranslations("timeline"),
  ])
  if (!patient) notFound()
  const doctor = await loadDoctor(patient.assigned_doctor_id)
  const rows = followups ?? []
  const last = rows.at(-1)
  return (
    <ReportDocument type="pregnancy_summary" patient={patient} doctor={doctor} subtitle={t("pregnancyCase", { number: pcase.case_number })}>
      <ReportSection title={t("sections.pregnancy")}>
        <KeyValues
          items={[
            [t("fields.status"), tt.has(`status.${pcase.status}`) ? tt(`status.${pcase.status}`) : pcase.status],
            ["LMP", pcase.lmp ? formatDate(pcase.lmp) : null],
            ["EDD", pcase.edd ? formatDate(pcase.edd) : null],
            ["G / P", `${pcase.gravida ?? "—"} / ${pcase.para ?? "—"}`],
            [t("fields.opened"), messageDate(pcase.opened_at)],
            [t("fields.closed"), pcase.closed_at ? messageDate(pcase.closed_at) : null],
            [t("fields.outcome"), pcase.outcome],
            [t("fields.history"), pcase.history],
          ]}
        />
      </ReportSection>
      {last && (
        <ReportSection title={t("latestFollowup")}>
          <KeyValues
            items={[
              [t("fields.date"), formatDate(last.followup_date)],
              [t("fields.weight"), last.weight_kg != null ? `${last.weight_kg} kg` : null],
              ["BP", last.bp_systolic ? `${last.bp_systolic}/${last.bp_diastolic ?? "—"}` : null],
              ["C/O", last.complaint],
              ["U/S", last.ultrasound],
              [t("fields.plan"), last.plan],
            ]}
          />
        </ReportSection>
      )}
      <ReportSection title={t("followups", { count: rows.length })}>
        <ReportTable
          head={["#", t("fields.date"), t("fields.weight"), "BP", "C/O", "U/S", "Lab", t("fields.plan")]}
          rows={rows.map((f) => [
            String(f.visit_no),
            formatDate(f.followup_date),
            f.weight_kg != null ? String(f.weight_kg) : "",
            f.bp_systolic ? `${f.bp_systolic}/${f.bp_diastolic ?? ""}` : "",
            f.complaint ?? "",
            f.ultrasound ?? "",
            f.lab ?? "",
            f.plan ?? "",
          ])}
          empty={t("none")}
        />
      </ReportSection>
    </ReportDocument>
  )
}
