import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { ReportDocument, ReportTable, formatDateTime, loadDoctor, loadReportPatient } from "@/components/documents/report"

/** The patient timeline as generated from real records (RLS applies per source). */
export default async function TimelineReport({ params }: PageProps<"/print/report/timeline/[patientId]">) {
  await requirePagePermission(P.patientsView)
  const { patientId } = await params
  if (!/^[0-9a-f-]{36}$/.test(patientId)) notFound()
  const patient = await loadReportPatient(patientId)
  if (!patient) notFound()
  const supabase = await createClient()
  const [{ data: events }, t, tt, locale] = await Promise.all([
    supabase.from("patient_timeline").select("*").eq("patient_id", patientId).not("occurred_at", "is", null).order("occurred_at", { ascending: false }).limit(500),
    getTranslations("reports"),
    getTranslations("timeline"),
    getLocale(),
  ])
  const doctor = await loadDoctor(patient.assigned_doctor_id)
  return (
    <ReportDocument type="timeline" patient={patient} doctor={doctor}>
      <ReportTable
        head={[t("fields.date"), t("fields.event"), t("fields.type"), t("fields.status")]}
        rows={(events ?? []).map((e) => [
          formatDateTime(e.occurred_at, locale),
          tt.has(`event.${e.event_type}`) ? tt(`event.${e.event_type}`, { number: e.number ?? "" }) : e.event_type,
          e.subtype ? (tt.has(`subtype.${e.subtype}`) ? tt(`subtype.${e.subtype}`) : e.subtype) : "",
          e.status ? (tt.has(`status.${e.status}`) ? tt(`status.${e.status}`) : e.status) : "",
        ])}
        empty={t("none")}
      />
    </ReportDocument>
  )
}
