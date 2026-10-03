import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { NewReportForm } from "@/components/reports/new-report-form"
import type { ReportTemplate } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("medicalReports")
  return { title: t("new") }
}

/** Reports → New report: for a registered patient (prefilled) or a standalone person. */
export default async function NewReportPage({ searchParams }: PageProps<"/reports/new">) {
  await requirePagePermission(P.reportsCreate)
  const sp = await searchParams
  const patientId = typeof sp.patient === "string" && /^[0-9a-f-]{36}$/.test(sp.patient) ? sp.patient : null
  const visitId = typeof sp.visit === "string" && /^[0-9a-f-]{36}$/.test(sp.visit) ? sp.visit : null
  const supabase = await createClient()
  const [{ data: templates }, patient] = await Promise.all([
    supabase.from("report_templates").select("*").eq("active", true).order("sort_order"),
    patientId ? supabase.from("patients").select("id, full_name, patient_code").eq("id", patientId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ])
  return <NewReportForm templates={(templates ?? []) as ReportTemplate[]} patient={patient} visitId={visitId} />
}
