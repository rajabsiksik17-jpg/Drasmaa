"use client"

import { useTranslations } from "next-intl"
import { DrawingEditor } from "@/components/drawings/drawing-editor"
import { ExportMenu } from "@/components/documents/export-menu"
import { FormSaveProvider, SaveIndicator } from "@/components/forms/save-state"
import type { MedicalDrawing } from "@/types/db"

export function DrawingPageClient({
  drawing,
  background,
  patientId,
  canEdit,
  visitCompleted,
  visitCancelled,
}: {
  drawing: MedicalDrawing
  background: string | null
  patientId: string
  canEdit: boolean
  visitCompleted: boolean
  visitCancelled: boolean
}) {
  const t = useTranslations("drawings")
  return (
    <FormSaveProvider>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{drawing.title ?? (drawing.image_id ? t("ultrasoundImage") : t("diagram"))}</h1>
          <div className="ms-auto flex items-center gap-2">
            <SaveIndicator />
            <ExportMenu target={{ type: "drawing", entityId: drawing.id, patientId }} size="default" />
          </div>
        </div>
        <DrawingEditor drawing={drawing} background={background} canEdit={canEdit && !visitCancelled} visitCompleted={visitCompleted} />
      </div>
    </FormSaveProvider>
  )
}
