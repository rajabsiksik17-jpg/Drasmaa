import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { Printer } from "lucide-react"
import { ExportMenu } from "@/components/documents/export-menu"
import { requirePagePermission, hasPermission } from "@/lib/auth/session"
import { getPatientContext } from "@/lib/data/patient"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { ageFromDob, clinicToday, isoToClinicParts } from "@/lib/dates"
import { Breadcrumbs } from "@/components/common/page"
import { CaseStatusBadge } from "@/components/common/status-badge"
import { PregnancyCaseWorkspace } from "@/components/pregnancy/pregnancy-case-workspace"
import { CloseCaseButton, NewVisitButton } from "@/components/patients/case-actions"
import { Button } from "@/components/ui/button"
import type { PatientHusband, PregnancyCase, PregnancyFollowup } from "@/types/db"

export const metadata: Metadata = { title: "Pregnancy" }

export default async function PregnancyCasePage({ params }: PageProps<"/patients/[patientId]/pregnancies/[caseId]">) {
  const session = await requirePagePermission(P.pregnancyView)
  const { patientId, caseId } = await params
  if (!/^[0-9a-f-]{36}$/.test(caseId)) notFound()
  const t = await getTranslations("cases")
  const tn = await getTranslations("nav")
  const tv = await getTranslations("visits")
  const ctx = await getPatientContext(patientId)
  const supabase = await createClient()
  const [{ data: pcase }, { data: followups }, { data: husband }] = await Promise.all([
    supabase.from("pregnancy_cases").select("*").eq("id", caseId).eq("patient_id", patientId).maybeSingle(),
    supabase.from("pregnancy_followups").select("*, visit:visits(status)").eq("pregnancy_case_id", caseId).order("visit_no"),
    supabase.from("patient_husbands").select("*").eq("patient_id", patientId).maybeSingle(),
  ])
  if (!pcase) notFound()
  const rows = (followups ?? []) as (PregnancyFollowup & { visit: { status: string } | null })[]
  const today = clinicToday()
  const editable = rows
    .filter((r) => (r.visit ? r.visit.status === "draft" || r.visit.status === "in_progress" : isoToClinicParts(r.created_at).date === today))
    .map((r) => r.id)
  const can = (c: (typeof P)[keyof typeof P]) => hasPermission(session, c)
  const h = husband as PatientHusband | null
  const c = pcase as PregnancyCase

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { href: "/patients", label: tn("patients") },
          { href: `/patients/${patientId}`, label: ctx.patient.full_name },
          { href: `/patients/${patientId}?tab=pregnancy`, label: t("pregnancies") },
          { label: t("pregnancyCase", { number: c.case_number }) },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{t("pregnancyCase", { number: c.case_number })}</h2>
        <CaseStatusBadge status={c.status} />
        <div className="ms-auto flex flex-wrap gap-2">
          {c.status === "active" && can(P.visitsCreate) && <NewVisitButton patientId={patientId} type="pregnancy" label={tv("newFollowUp")} />}
          <ExportMenu target={{ type: "pregnancy_summary", entityId: c.id, patientId }} label={tv("exportSummary")} />
          <ExportMenu target={{ type: "pregnancy_followup", entityId: c.id, patientId }} label={tv("exportFollowup")} />
          <Button variant="outline" size="sm" asChild>
            <a href={`/print/pregnancy/${c.id}`} target="_blank" rel="noopener">
              <Printer />
              {tv("print")}
            </a>
          </Button>
          {c.status === "active" && can(P.pregnancyEdit) && <CloseCaseButton caseId={c.id} kind="pregnancy" />}
        </div>
      </div>
      <PregnancyCaseWorkspace
        pcase={c}
        followups={rows.map(({ visit: _v, ...r }) => r as PregnancyFollowup)}
        patient={{
          full_name: ctx.patient.full_name,
          age: ageFromDob(ctx.patient.dob),
          patient_code: ctx.patient.patient_code,
          wifeBlood: [ctx.patient.blood_group, ctx.patient.rh].filter(Boolean).join(" "),
          husbandBlood: [h?.blood_group, h?.rh].filter(Boolean).join(" "),
        }}
        editableRowIds={editable}
        canEditCase={can(P.pregnancyEdit) && c.status === "active"}
        canCorrect={can(P.visitsEditCompleted) || can(P.pregnancyEdit)}
        historical={c.status !== "active"}
      />
    </div>
  )
}
