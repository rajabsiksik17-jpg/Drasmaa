import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission, hasPermission } from "@/lib/auth/session"
import { getPatientContext } from "@/lib/data/patient"
import { getHistoryExamData } from "@/lib/data/history"
import { getVisitBundle } from "@/lib/data/visit"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { formatDate } from "@/lib/dates"
import { Breadcrumbs } from "@/components/common/page"
import { VisitWorkspace } from "@/components/visits/visit-workspace"
import { VisitExtras } from "@/components/visits/visit-extras"
import type { PrescriptionWithItems } from "@/components/prescriptions/prescription-editor"
import type { InvoiceSummary } from "@/components/accounting/billing-summary"
import { loadDrawings } from "@/lib/data/drawings"
import type { TimelineEvent } from "@/types/db"

export async function generateMetadata({ params }: PageProps<"/patients/[patientId]/visits/[visitId]">): Promise<Metadata> {
  const t = await getTranslations("visits")
  const { patientId, visitId } = await params
  const bundle = await getVisitBundle(patientId, visitId)
  return { title: `${t(`type.${bundle.visit.visit_type}`)} · ${formatDate(bundle.visit.visit_date)}` }
}

export default async function VisitPage({ params }: PageProps<"/patients/[patientId]/visits/[visitId]">) {
  const session = await requirePagePermission(P.visitsView)
  const { patientId, visitId } = await params
  const t = await getTranslations("visits")
  const tn = await getTranslations("nav")
  const [ctx, bundle, history] = await Promise.all([
    getPatientContext(patientId),
    getVisitBundle(patientId, visitId),
    getHistoryExamData(patientId),
  ])
  const supabase = await createClient()
  const { data: timeline } = await supabase
    .from("patient_timeline")
    .select("*")
    .eq("patient_id", patientId)
    .order("occurred_at", { ascending: false })
    .limit(20)

  const can = (c: (typeof P)[keyof typeof P]) => hasPermission(session, c)
  const [drawings, prescriptions, invoice] = await Promise.all([
    can(P.drawingsView) ? loadDrawings({ visitId }) : Promise.resolve([]),
    can(P.prescriptionsView)
      ? supabase.from("prescriptions").select("*, items:prescription_items(*)").eq("visit_id", visitId).order("created_at").then((r) => (r.data ?? []) as PrescriptionWithItems[])
      : Promise.resolve([] as PrescriptionWithItems[]),
    can(P.accountingView)
      ? supabase
          .from("invoices")
          .select("id, invoice_number, status, currency, subtotal, discount_amount, total, insurance_amount, patient_amount, paid_patient, paid_insurance, balance_patient, balance_insurance, payment_type, lines:invoice_lines(description_en, description_ar, quantity, line_total, package_line_id, sort_order)")
          .or(`visit_id.eq.${visitId}${bundle.visit.appointment_id ? `,appointment_id.eq.${bundle.visit.appointment_id}` : ""}`)
          .neq("status", "void")
          .limit(1)
          .maybeSingle()
          .then((r) => (r.data as InvoiceSummary | null) ?? null)
      : Promise.resolve(null),
  ])
  const vs = bundle.visit
  const context: "pregnancy" | "fertility" | "gynecology" = vs.visit_type === "pregnancy" ? "pregnancy" : vs.visit_type === "fertility" ? "fertility" : "gynecology"
  const extraSections = [
    ...(can(P.drawingsView) ? [{ id: "vx-imaging", label: t("sec.imaging") }] : []),
    ...(can(P.prescriptionsView) ? [{ id: "vx-rx", label: t("sec.prescription") }] : []),
    ...(invoice ? [{ id: "vx-billing", label: t("sec.billing") }] : []),
  ]
  const extras = (
    <VisitExtras
      patientId={patientId}
      visitId={visitId}
      status={vs.status}
      context={context}
      drawings={drawings}
      prescriptions={prescriptions}
      invoice={invoice}
      show={{ imaging: can(P.drawingsView), prescriptions: can(P.prescriptionsView) }}
    />
  )
  const typePermission = { fertility: P.fertilityEdit, pregnancy: P.pregnancyEdit, gynecology: P.gynecologyEdit }[bundle.visit.visit_type]

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { href: "/patients", label: tn("patients") },
          { href: `/patients/${patientId}`, label: ctx.patient.full_name },
          { href: `/patients/${patientId}?tab=visits`, label: t("title") },
          { label: `${t(`type.${bundle.visit.visit_type}`)} · ${formatDate(bundle.visit.visit_date)}` },
        ]}
      />
      <VisitWorkspace
        patient={{ id: ctx.patient.id, full_name: ctx.patient.full_name, patient_code: ctx.patient.patient_code }}
        bundle={bundle}
        history={history}
        timeline={(timeline ?? []) as TimelineEvent[]}
        perms={{
          editVisit: can(P.visitsEdit),
          editType: can(typePermission),
          complete: can(P.visitsComplete),
          correct: can(P.visitsEditCompleted),
          editPatient: can(P.patientsEdit),
          editMedical: can(P.medicalEdit),
          investigations: can(P.investigationsEdit),
          oi: can(P.oiEdit),
          upload: can(P.documentsUpload),
          viewDocuments: can(P.documentsView),
        }}
        extras={extras}
        extraSections={extraSections}
      />
    </div>
  )
}
