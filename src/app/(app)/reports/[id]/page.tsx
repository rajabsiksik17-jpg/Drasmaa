import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { ReportEditor } from "@/components/reports/report-editor"
import type { MedicalReport } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("medicalReports")
  return { title: t("title") }
}

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const session = await requirePagePermission(P.reportsView)
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const supabase = await createClient()
  const { data } = await supabase.from("medical_reports").select("*").eq("id", id).maybeSingle()
  if (!data) notFound()
  const report = data as MedicalReport
  const { data: versions } = await supabase.from("medical_report_versions").select("id, version_no, created_at, snapshot").eq("report_id", id).order("version_no", { ascending: false })
  const own = report.created_by === session.userId
  return (
    <ReportEditor
      report={report}
      versions={(versions ?? []) as { id: string; version_no: number; created_at: string; snapshot: MedicalReport }[]}
      can={{
        edit: report.status !== "void" && (hasPermission(session, P.reportsEdit) || (own && report.status === "draft" && hasPermission(session, P.reportsCreate))),
        void: report.status !== "void" && hasPermission(session, P.reportsDelete),
        link: !report.patient_id && hasPermission(session, P.reportsEdit),
        duplicate: hasPermission(session, P.reportsCreate),
      }}
    />
  )
}
