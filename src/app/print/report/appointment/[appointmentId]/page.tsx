import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { KeyValues, ReportDocument, ReportSection, loadDoctor, loadReportPatient } from "@/components/documents/report"
import { messageDate, messageTime } from "@/lib/messaging/variables"

export default async function AppointmentReport({ params }: PageProps<"/print/report/appointment/[appointmentId]">) {
  await requirePagePermission(P.appointmentsView)
  const { appointmentId } = await params
  if (!/^[0-9a-f-]{36}$/.test(appointmentId)) notFound()
  const supabase = await createClient()
  const { data: a } = await supabase.from("appointments").select("*").eq("id", appointmentId).maybeSingle()
  if (!a) notFound()
  const [patient, doctor, { data: opt }, { data: dept }, { data: clinic }, t, tt, locale] = await Promise.all([
    loadReportPatient(a.patient_id),
    loadDoctor(a.doctor_id),
    supabase.from("dropdown_options").select("label_en, label_ar").eq("category", "appointment_type").eq("value", a.visit_type).maybeSingle(),
    supabase.from("departments").select("name_en, name_ar").eq("id", a.department_id).maybeSingle(),
    supabase.from("clinic_settings").select("phone, address_en, address_ar").eq("id", 1).single(),
    getTranslations("reports"),
    getTranslations("timeline"),
    getLocale(),
  ])
  if (!patient) notFound()
  const ar = locale === "ar"
  const lang = ar ? "ar" : "en"
  return (
    <ReportDocument type="appointment_summary" patient={patient} doctor={doctor}>
      <ReportSection title={t("appointmentDetails")}>
        <div className="mb-3 rounded border-2 border-black/70 px-4 py-3 text-center">
          <p className="text-[20px] font-bold">{messageDate(a.scheduled_at)}</p>
          <p className="text-[16px] font-semibold">{messageTime(a.scheduled_at, lang)}</p>
        </div>
        <KeyValues
          items={[
            [t("fields.type"), (ar ? opt?.label_ar : opt?.label_en) ?? a.visit_type],
            [t("doctor"), doctor ? (ar ? doctor.display_name_ar || doctor.display_name_en : doctor.display_name_en) : null],
            [t("fields.department"), dept ? (ar ? dept.name_ar : dept.name_en) : null],
            [t("fields.duration"), t("minutes", { n: a.duration_minutes })],
            [t("fields.status"), tt.has(`status.${a.status}`) ? tt(`status.${a.status}`) : a.status],
            [t("fields.address"), ar ? clinic?.address_ar || clinic?.address_en : clinic?.address_en],
            [t("fields.phone"), clinic?.phone],
          ]}
        />
        <p className="mt-4 text-[11.5px]">{t("arriveEarly")}</p>
      </ReportSection>
    </ReportDocument>
  )
}
