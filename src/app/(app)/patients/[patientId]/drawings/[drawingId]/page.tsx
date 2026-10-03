import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { getPatientContext } from "@/lib/data/patient"
import { loadDrawings } from "@/lib/data/drawings"
import { P } from "@/lib/permissions"
import { formatDate, formatDateTime } from "@/lib/dates"
import { Breadcrumbs } from "@/components/common/page"
import { DrawingPageClient } from "@/components/drawings/drawing-page-client"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("drawings")
  return { title: t("title") }
}

/** Patient → Medical drawing: date, visit, doctor, image + drawing, notes, PDF, share. */
export default async function DrawingPage({ params }: PageProps<"/patients/[patientId]/drawings/[drawingId]">) {
  const session = await requirePagePermission(P.drawingsView)
  const { patientId, drawingId } = await params
  if (!/^[0-9a-f-]{36}$/.test(drawingId)) notFound()
  const [ctx, items] = await Promise.all([getPatientContext(patientId), loadDrawings({ drawingId })])
  const item = items[0]
  if (!item || item.drawing.patient_id !== patientId) notFound()
  const supabase = await createClient()
  const { data: visit } = await supabase
    .from("visits")
    .select("id, visit_date, visit_type, status, doctor:doctors(display_name_en, display_name_ar)")
    .eq("id", item.drawing.visit_id)
    .maybeSingle()
  const t = await getTranslations("drawings")
  const tv = await getTranslations("visits")
  const tn = await getTranslations("nav")
  const locale = await getLocale()
  const doctor = visit?.doctor as unknown as { display_name_en: string; display_name_ar: string | null } | null
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Breadcrumbs
        items={[
          { href: "/patients", label: tn("patients") },
          { href: `/patients/${patientId}`, label: ctx.patient.full_name },
          { label: item.drawing.title ?? t("title") },
        ]}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{formatDateTime(item.drawing.created_at, locale)}</span>
        {visit && (
          <Link href={`/patients/${patientId}/visits/${visit.id}`} className="text-primary hover:underline">
            {tv(`type.${visit.visit_type}`)} · {formatDate(visit.visit_date)}
          </Link>
        )}
        {doctor && <span>{locale === "ar" ? doctor.display_name_ar || doctor.display_name_en : doctor.display_name_en}</span>}
      </div>
      <DrawingPageClient
        drawing={item.drawing}
        background={item.background}
        patientId={patientId}
        canEdit={hasPermission(session, P.drawingsEdit) || hasPermission(session, P.drawingsCreate)}
        visitCompleted={visit?.status === "completed"}
        visitCancelled={visit?.status === "cancelled"}
      />
    </div>
  )
}
