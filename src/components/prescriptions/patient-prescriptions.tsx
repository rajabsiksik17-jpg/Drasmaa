"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, Pill, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/common/page"
import { useCan } from "@/components/app-context"
import { PrescriptionEditor, type PrescriptionWithItems } from "@/components/prescriptions/prescription-editor"
import { useActionError } from "@/hooks/use-action-error"
import { createPrescription } from "@/lib/actions/prescriptions"
import { P } from "@/lib/permissions"

/** Patient → Prescriptions. A new prescription outside a visit (e.g. renewal) is possible. */
export function PatientPrescriptions({ patientId, prescriptions }: { patientId: string; prescriptions: PrescriptionWithItems[] }) {
  const t = useTranslations("prescriptions")
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useTransition()
  const standaloneDraft = prescriptions.find((p) => p.status === "draft" && !p.visit_id)
  return (
    <SectionCard
      title={t("title")}
      icon={Pill}
      actions={
        can(P.prescriptionsCreate) && !standaloneDraft ? (
          <Button
            size="xs"
            onClick={() =>
              start(async () => {
                const res = await createPrescription(patientId)
                if (!res.ok) return showError(res.error)
                router.refresh()
              })
            }
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("newPrescription")}
          </Button>
        ) : null
      }
    >
      {standaloneDraft && (
        <div className="mb-4">
          <PrescriptionEditor patientId={patientId} visitId={null} prescriptions={[standaloneDraft]} visitOpen />
        </div>
      )}
      <PrescriptionEditor
        patientId={patientId}
        visitId={null}
        prescriptions={prescriptions.filter((p) => p.id !== standaloneDraft?.id && p.status !== "draft")}
        visitOpen={false}
      />
    </SectionCard>
  )
}
