import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { ReportDocument, ReportSection, ReportTable, formatDate, loadDoctor, loadReportPatient } from "@/components/documents/report"

/** All results (history kept) of the selected tests, grouped per test. */
export default async function InvestigationsReport({ params, searchParams }: PageProps<"/print/report/investigations/[patientId]">) {
  await requirePagePermission(P.investigationsView)
  const { patientId } = await params
  if (!/^[0-9a-f-]{36}$/.test(patientId)) notFound()
  const sp = await searchParams
  const codes = typeof sp.codes === "string" ? sp.codes.split(",").filter((c) => /^[a-z0-9_]+$/.test(c)) : []
  const patient = await loadReportPatient(patientId)
  if (!patient) notFound()
  const supabase = await createClient()
  let q = supabase
    .from("investigation_results")
    .select("type_code, value_numeric, value_text, unit, result_date, notes")
    .eq("patient_id", patientId)
    .order("result_date", { ascending: false })
    .limit(1000)
  if (codes.length) q = q.in("type_code", codes)
  const [{ data: results }, { data: types }, t, locale] = await Promise.all([
    q,
    supabase.from("investigation_types").select("code, name_en, name_ar, unit, sort_order").order("sort_order"),
    getTranslations("reports"),
    getLocale(),
  ])
  const doctor = await loadDoctor(patient.assigned_doctor_id)
  const ar = locale === "ar"
  const rows = results ?? []
  const groups = (types ?? []).filter((ty) => rows.some((r) => r.type_code === ty.code))

  return (
    <ReportDocument type="investigations" patient={patient} doctor={doctor}>
      {groups.length === 0 && <p>{t("none")}</p>}
      {groups.map((ty) => (
        <ReportSection key={ty.code} title={`${ar ? ty.name_ar : ty.name_en}${ty.unit ? ` (${ty.unit})` : ""}`}>
          <ReportTable
            head={[t("fields.date"), t("fields.result"), t("fields.notes")]}
            rows={rows
              .filter((r) => r.type_code === ty.code)
              .map((r) => [formatDate(r.result_date), [r.value_numeric ?? r.value_text, r.unit && r.unit !== ty.unit ? r.unit : null].filter((x) => x != null && x !== "").join(" "), r.notes ?? ""])}
          />
        </ReportSection>
      ))}
    </ReportDocument>
  )
}
