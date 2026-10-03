"use client"

import { useTranslations } from "next-intl"
import { Pill, Receipt, ScanLine } from "lucide-react"
import { CollapsibleSection } from "@/components/common/collapsible-section"
import { VisitImaging, type DrawingWithBackground } from "@/components/drawings/visit-imaging"
import { PrescriptionEditor, type PrescriptionWithItems } from "@/components/prescriptions/prescription-editor"
import { BillingSummary, type InvoiceSummary } from "@/components/accounting/billing-summary"
import type { ClinicalContext, VisitStatus } from "@/types/db"

/** Visit sections that sit after the clinical forms: imaging, prescription, billing. */
export function VisitExtras({
  patientId,
  visitId,
  status,
  context,
  drawings,
  prescriptions,
  invoice,
  show,
}: {
  patientId: string
  visitId: string
  status: VisitStatus
  context: ClinicalContext
  drawings: DrawingWithBackground[]
  prescriptions: PrescriptionWithItems[]
  invoice: InvoiceSummary | null
  show: { imaging: boolean; prescriptions: boolean }
}) {
  const t = useTranslations("visits")
  const open = status === "draft" || status === "in_progress"
  return (
    <>
      {show.imaging && (
        <CollapsibleSection id="vx-imaging" title={t("sec.imaging")} icon={ScanLine} defaultOpen={drawings.length > 0 || context === "gynecology"}>
          <VisitImaging
            patientId={patientId}
            visitId={visitId}
            context={context}
            items={drawings}
            visitCompleted={status === "completed"}
            visitCancelled={status === "cancelled"}
          />
        </CollapsibleSection>
      )}
      {show.prescriptions && (
        <CollapsibleSection id="vx-rx" title={t("sec.prescription")} icon={Pill} defaultOpen={prescriptions.length > 0 || open}>
          <PrescriptionEditor patientId={patientId} visitId={visitId} prescriptions={prescriptions} visitOpen={open} />
        </CollapsibleSection>
      )}
      {invoice && (
        <CollapsibleSection id="vx-billing" title={t("sec.billing")} icon={Receipt} defaultOpen={status === "completed"}>
          <BillingSummary invoice={invoice} />
        </CollapsibleSection>
      )}
    </>
  )
}
