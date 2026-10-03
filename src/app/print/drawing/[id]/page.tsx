import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { loadDrawingsEmbedded } from "@/lib/data/drawings"
import { formatDate, formatDateTime } from "@/lib/dates"
import { KeyValues, ReportDocument, ReportSection, loadDoctor, loadReportPatient } from "@/components/documents/report"
import { DrawingSvg } from "@/components/drawings/drawing-svg"

/** Original ultrasound + the doctor's annotation layer (vector) + notes. */
export default async function DrawingPrint({ params }: PageProps<"/print/drawing/[id]">) {
  await requirePagePermission(P.drawingsView)
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const [item] = await loadDrawingsEmbedded({ drawingId: id })
  if (!item) notFound()
  const d = item.drawing
  const supabase = await createClient()
  const { data: visit } = await supabase.from("visits").select("visit_date, visit_type, doctor_id").eq("id", d.visit_id).maybeSingle()
  const [patient, doctor, t, tv, locale] = await Promise.all([
    loadReportPatient(d.patient_id),
    loadDoctor(visit?.doctor_id),
    getTranslations("drawings"),
    getTranslations("visits"),
    getLocale(),
  ])
  if (!patient) notFound()
  return (
    <ReportDocument type="drawing" title={d.title ?? undefined} patient={patient} doctor={doctor} documentDate={visit?.visit_date ?? d.created_at.slice(0, 10)}>
      <KeyValues
        items={[
          [t("visit"), visit ? `${tv(`type.${visit.visit_type}`)} · ${formatDate(visit.visit_date)}` : null],
          [t("created"), formatDateTime(d.created_at, locale)],
        ]}
      />
      <div className="print-avoid-break overflow-hidden rounded border border-black/30">
        <DrawingSvg shapes={d.shapes} width={d.canvas_width} height={d.canvas_height} background={item.background} title={d.title ?? t("title")} />
      </div>
      {d.notes && (
        <ReportSection title={t("notes")}>
          <p className="whitespace-pre-wrap">{d.notes}</p>
        </ReportSection>
      )}
    </ReportDocument>
  )
}
