import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { ReportsList, type ReportListRow } from "@/components/reports/reports-list"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("medicalReports")
  return { title: t("title") }
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requirePagePermission(P.reportsView)
  const sp = await searchParams
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "")
  const filters = { q: str("q").slice(0, 80), type: str("type"), language: str("language"), doctor: str("doctor"), from: str("from"), to: str("to"), status: str("status") }
  const supabase = await createClient()
  let q = supabase
    .from("medical_reports")
    .select("id, report_number, report_date, report_type, language, status, subject_name, subject_patient_code, patient_id, created_by, doctor:doctors(display_name_en, display_name_ar)")
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300)
  if (filters.q) {
    const safe = filters.q.replace(/[%_,()]/g, " ")
    q = q.or(`subject_name.ilike.%${safe}%,report_number.ilike.%${safe}%,subject_patient_code.ilike.%${safe}%`)
  }
  if (filters.type) q = q.eq("report_type", filters.type)
  if (["ar", "en", "bilingual"].includes(filters.language)) q = q.eq("language", filters.language)
  if (/^[0-9a-f-]{36}$/.test(filters.doctor)) q = q.eq("doctor_id", filters.doctor)
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.from)) q = q.gte("report_date", filters.from)
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) q = q.lte("report_date", filters.to)
  if (["draft", "final", "void"].includes(filters.status)) q = q.eq("status", filters.status)
  const [{ data }, { data: profiles }] = await Promise.all([q, supabase.from("profiles").select("id, full_name")])
  return (
    <ReportsList
      rows={(data ?? []) as unknown as ReportListRow[]}
      filters={filters}
      people={Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]))}
    />
  )
}
