import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { ReportDocument, ReportTable, loadDoctor, loadReportPatient } from "@/components/documents/report"
import type { Prescription, PrescriptionItem } from "@/types/db"

export default async function PrescriptionPrint({ params }: PageProps<"/print/prescription/[id]">) {
  await requirePagePermission(P.prescriptionsView)
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const supabase = await createClient()
  const { data } = await supabase.from("prescriptions").select("*, items:prescription_items(*)").eq("id", id).maybeSingle()
  if (!data) notFound()
  const rx = data as Prescription & { items: PrescriptionItem[] }
  const [patient, doctor, t] = await Promise.all([loadReportPatient(rx.patient_id), loadDoctor(rx.doctor_id), getTranslations("prescriptions")])
  if (!patient) notFound()
  const items = [...rx.items].sort((a, b) => a.sort_order - b.sort_order)
  return (
    <ReportDocument
      type="prescription"
      patient={patient}
      doctor={doctor}
      number={rx.prescription_number}
      documentDate={(rx.issued_at ?? rx.created_at).slice(0, 10)}
      footerKind="prescription"
      subtitle={rx.status === "cancelled" ? t("status.cancelled") : undefined}
    >
      <p className="text-[22px] leading-none font-bold" aria-hidden>
        ℞
      </p>
      <ReportTable
        head={[t("fields.medication"), t("fields.dose"), t("fields.route"), t("fields.frequency"), t("fields.duration"), t("fields.quantity"), t("fields.instructions")]}
        rows={items.map((i) => [
          <span key="m">
            <b>{i.medication_name}</b>
            {i.form ? <span className="text-black/60"> · {i.form}</span> : null}
          </span>,
          i.dose ?? "",
          i.route ?? "",
          i.frequency ?? "",
          i.duration ?? "",
          i.quantity ?? "",
          i.instructions ?? "",
        ])}
        empty={t("empty")}
      />
      {rx.notes && <p className="whitespace-pre-wrap">{rx.notes}</p>}
    </ReportDocument>
  )
}
