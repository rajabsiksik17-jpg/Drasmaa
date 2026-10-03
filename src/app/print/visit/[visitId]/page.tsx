import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { loadDrawingsEmbedded } from "@/lib/data/drawings"
import { DrawingSvg } from "@/components/drawings/drawing-svg"
import { createClient } from "@/lib/supabase/server"
import { getHistoryExamData } from "@/lib/data/history"
import { getVisitBundle } from "@/lib/data/visit"
import { P } from "@/lib/permissions"
import { PrintVisit } from "@/components/print/print-views"

export default async function PrintVisitPage({ params }: PageProps<"/print/visit/[visitId]">) {
  const session = await requirePagePermission(P.visitsView)
  const { visitId } = await params
  if (!/^[0-9a-f-]{36}$/.test(visitId)) notFound()
  const supabase = await createClient()
  const { data: v } = await supabase.from("visits").select("patient_id").eq("id", visitId).maybeSingle()
  if (!v) notFound()
  const [bundle, history] = await Promise.all([getVisitBundle(v.patient_id, visitId), getHistoryExamData(v.patient_id)])
  if (!history) notFound()
  const drawings = hasPermission(session, P.drawingsView) ? await loadDrawingsEmbedded({ visitId }) : []
  const t = await getTranslations("drawings")
  return (
    <>
      <PrintVisit bundle={bundle} history={history} />
      {drawings.length > 0 && (
        <section className="paper mx-auto mt-4 max-w-[210mm] space-y-4 bg-white px-6 py-4 text-black print:px-0">
          <h2 className="border-b border-black/50 pb-1 text-[14px] font-bold">{t("sectionTitle")}</h2>
          {drawings.map(({ drawing, background }) => (
            <figure key={drawing.id} className="print-avoid-break space-y-1.5">
              {drawing.title && <figcaption className="text-[12px] font-semibold">{drawing.title}</figcaption>}
              <div className="overflow-hidden rounded border border-black/30">
                <DrawingSvg shapes={drawing.shapes} width={drawing.canvas_width} height={drawing.canvas_height} background={background} />
              </div>
              {drawing.notes && <p className="text-[12px] whitespace-pre-wrap">{drawing.notes}</p>}
            </figure>
          ))}
        </section>
      )}
    </>
  )
}
