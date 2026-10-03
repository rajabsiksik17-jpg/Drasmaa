import type { Metadata } from "next"
import { Suspense } from "react"
import { requirePagePermission, hasPermission } from "@/lib/auth/session"
import { getPatientContext } from "@/lib/data/patient"
import { P } from "@/lib/permissions"
import { PatientTabs, type PatientTabKey } from "@/components/patients/patient-tabs"
import { OverviewTab } from "@/components/patients/tabs/overview-tab"
import { PersonalTab } from "@/components/patients/tabs/personal-tab"
import { MedicalTab } from "@/components/patients/tabs/medical-tab"
import { VisitsTab } from "@/components/patients/tabs/visits-tab"
import { AppointmentsTab } from "@/components/patients/tabs/appointments-tab"
import { FertilityTab } from "@/components/patients/tabs/fertility-tab"
import { PregnancyTab } from "@/components/patients/tabs/pregnancy-tab"
import { CyclesTab } from "@/components/patients/tabs/cycles-tab"
import { InvestigationsTab } from "@/components/patients/tabs/investigations-tab"
import { DocumentsTab } from "@/components/patients/tabs/documents-tab"
import { TimelineTab } from "@/components/patients/tabs/timeline-tab"
import { CommunicationsTab } from "@/components/patients/tabs/communications-tab"
import { BillingTab, DrawingsTab, PrescriptionsTab, ReportsTab } from "@/components/patients/tabs/clinical-docs-tabs"
import { AuditTab } from "@/components/patients/tabs/audit-tab"
import { TabSkeleton } from "@/components/common/skeletons"

export async function generateMetadata({ params }: PageProps<"/patients/[patientId]">): Promise<Metadata> {
  const { patientId } = await params
  const ctx = await getPatientContext(patientId)
  return { title: ctx.patient.patient_code }
}

export default async function PatientPage({ params, searchParams }: PageProps<"/patients/[patientId]">) {
  const session = await requirePagePermission(P.patientsView)
  const { patientId } = await params
  const sp = await searchParams
  const ctx = await getPatientContext(patientId)
  const can = (c: (typeof P)[keyof typeof P]) => hasPermission(session, c)

  const available: PatientTabKey[] = [
    "overview",
    "personal",
    ...(can(P.medicalView) ? (["medical"] as const) : []),
    ...(can(P.visitsView) || can(P.visitsViewRecent) ? (["visits"] as const) : []),
    ...(can(P.appointmentsView) ? (["appointments"] as const) : []),
    ...(can(P.fertilityView) ? (["fertility"] as const) : []),
    ...(can(P.pregnancyView) ? (["pregnancy"] as const) : []),
    ...(can(P.oiView) ? (["oi"] as const) : []),
    ...(can(P.investigationsView) ? (["investigations"] as const) : []),
    ...(can(P.prescriptionsView) ? (["prescriptions"] as const) : []),
    ...(can(P.drawingsView) ? (["drawings"] as const) : []),
    ...(can(P.reportsView) ? (["reports"] as const) : []),
    ...(can(P.accountingView) ? (["billing"] as const) : []),
    "documents",
    "communications",
    "timeline",
    ...(can(P.auditView) ? (["audit"] as const) : []),
  ]
  const requested = typeof sp.tab === "string" ? (sp.tab as PatientTabKey) : "overview"
  const tab = available.includes(requested) ? requested : "overview"

  const tabs: Record<PatientTabKey, React.ReactNode> = {
    overview: <OverviewTab ctx={ctx} />,
    personal: <PersonalTab ctx={ctx} />,
    medical: <MedicalTab patientId={patientId} />,
    visits: <VisitsTab patientId={patientId} />,
    appointments: <AppointmentsTab ctx={ctx} />,
    fertility: <FertilityTab ctx={ctx} />,
    pregnancy: <PregnancyTab ctx={ctx} />,
    oi: <CyclesTab ctx={ctx} />,
    investigations: <InvestigationsTab patientId={patientId} />,
    prescriptions: <PrescriptionsTab patientId={patientId} />,
    drawings: <DrawingsTab patientId={patientId} />,
    reports: <ReportsTab patientId={patientId} />,
    billing: <BillingTab patientId={patientId} />,
    documents: <DocumentsTab patientId={patientId} />,
    communications: <CommunicationsTab patientId={patientId} />,
    timeline: <TimelineTab patientId={patientId} />,
    audit: <AuditTab patientId={patientId} />,
  }

  return (
    <div className="space-y-5">
      <PatientTabs current={tab} available={available} />
      <Suspense key={tab} fallback={<TabSkeleton />}>
        {tabs[tab]}
      </Suspense>
    </div>
  )
}
