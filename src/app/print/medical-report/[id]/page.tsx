import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { formatDate } from "@/lib/dates"
import { ReportDocument, loadDoctor, loadReportPatient } from "@/components/documents/report"
import type { MedicalReport } from "@/types/db"

const VARS = /\{\{\s*(patient_name|age|date|doctor_name|specialization|clinic_name|reference|dob|patient_id|country)\s*\}\}/g

/** A medical report exactly as written (its own snapshot of the person's details). */
export default async function MedicalReportPrint({ params }: PageProps<"/print/medical-report/[id]">) {
  await requirePagePermission(P.reportsView)
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const supabase = await createClient()
  const { data } = await supabase.from("medical_reports").select("*").eq("id", id).maybeSingle()
  if (!data) notFound()
  const r = data as MedicalReport
  const [patient, doctor, { data: clinic }, t] = await Promise.all([
    r.patient_id ? loadReportPatient(r.patient_id) : Promise.resolve(null),
    loadDoctor(r.doctor_id),
    supabase.from("clinic_settings").select("clinic_name_en, clinic_name_ar").eq("id", 1).single(),
    getTranslations("reports"),
  ])
  const fill = (text: string, lang: "ar" | "en") =>
    text.replace(VARS, (whole, k: string) => {
      const values: Record<string, string> = {
        patient_name: r.subject_name,
        age: r.subject_age != null ? String(r.subject_age) : "",
        date: formatDate(r.report_date),
        dob: r.subject_dob ? formatDate(r.subject_dob) : "",
        reference: r.subject_reference ?? "",
        country: r.subject_country ?? "",
        patient_id: r.subject_patient_code ?? "",
        doctor_name: (lang === "ar" ? doctor?.display_name_ar || doctor?.display_name_en : doctor?.display_name_en) ?? "",
        specialization: doctor?.specialty ?? "",
        clinic_name: (lang === "ar" ? clinic?.clinic_name_ar : clinic?.clinic_name_en) ?? "",
      }
      return values[k] ?? whole
    })
  const blocks: { lang: "ar" | "en"; body: string }[] = []
  if (r.language !== "ar" && r.body_en.trim()) blocks.push({ lang: "en", body: fill(r.body_en, "en") })
  if (r.language !== "en" && r.body_ar.trim()) blocks.push({ lang: "ar", body: fill(r.body_ar, "ar") })

  return (
    <ReportDocument
      type="medical_report"
      title={r.title ?? undefined}
      // Registered patients: identity from the report's own snapshot is shown via the patient block.
      patient={patient ? { ...patient, full_name: r.subject_name } : null}
      subject={
        patient
          ? null
          : {
              name: r.subject_name,
              dob: r.subject_dob,
              age: r.subject_age,
              code: r.subject_reference,
              extra: [[t("country"), r.subject_country]],
            }
      }
      doctor={doctor}
      number={r.report_number}
      documentDate={r.report_date}
      footerKind="report"
      subtitle={r.status === "void" ? t("voided") : r.status === "draft" ? t("draft") : undefined}
    >
      {r.recipient && <p className="font-semibold">{r.recipient}</p>}
      {blocks.map((b, i) => (
        <section key={b.lang} lang={b.lang} dir={b.lang === "ar" ? "rtl" : "ltr"} className={i > 0 ? "border-t border-black/20 pt-4" : undefined}>
          <p className="text-[13px] leading-7 whitespace-pre-wrap">{b.body}</p>
        </section>
      ))}
    </ReportDocument>
  )
}
