"use client"

import { useTranslations } from "next-intl"
import { Paperclip, Pill, Receipt, ScanLine } from "lucide-react"
import { VisitAttachments } from "@/components/visits/visit-quick-actions"
import { CollapsibleSection } from "@/components/common/collapsible-section"
import { VisitImaging, type DrawingWithBackground } from "@/components/drawings/visit-imaging"
import { PrescriptionEditor, type PrescriptionWithItems } from "@/components/prescriptions/prescription-editor"
import { VisitBill, type VisitBillInvoice } from "@/components/accounting/visit-bill"
import type { ClinicalContext, PatientDocument, VisitStatus } from "@/types/db"

/** Visit sections that sit after the clinical forms: imaging, prescription, billing. */
export function VisitExtras({
  patientId,
  visitId,
  status,
  context,
  drawings,
  archivedDrawings = [],
  prescriptions,
  invoice,
  attachments,
  show,
}: {
  patientId: string
  visitId: string
  status: VisitStatus
  context: ClinicalContext
  drawings: DrawingWithBackground[]
  archivedDrawings?: DrawingWithBackground[]
  prescriptions: PrescriptionWithItems[]
  invoice: VisitBillInvoice | null
  attachments?: { documents: PatientDocument[]; people: Record<string, string> } | null
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
            archived={archivedDrawings}
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
      {attachments && (
        <CollapsibleSection id="vx-files" title={t("sec.attachments")} icon={Paperclip} defaultOpen={attachments.documents.length > 0}>
          <VisitAttachments patientId={patientId} visitId={visitId} documents={attachments.documents} people={attachments.people} />
        </CollapsibleSection>
      )}
      {invoice && (
        <CollapsibleSection id="vx-billing" title={t("sec.billing")} icon={Receipt} defaultOpen={status === "completed" || status === "in_progress"}>
          <VisitBill invoice={invoice} editable={status !== "cancelled"} visitId={visitId} visitOpen={open} />
        </CollapsibleSection>
      )}
    </>
  )
}
