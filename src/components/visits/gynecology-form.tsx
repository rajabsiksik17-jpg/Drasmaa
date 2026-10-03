"use client"

import { useTranslations } from "next-intl"
import { useRecord } from "@/hooks/use-record"
import { ConflictBanner } from "@/components/forms/conflict-banner"
import { MedicalTextarea, MedicalYesNo } from "@/components/medical/medical-fields"
import { MedicalDrawingCanvas } from "@/components/medical/medical-drawing-canvas"
import { PaperHeading, PaperLine, PaperRule, PaperSheet } from "@/components/medical/paper"
import type { VisitBundle } from "@/lib/data/visit"
import type { GynecologyVisit } from "@/types/db"

export function GynecologyForm({
  data,
  patientId,
  visitId,
  canEdit,
}: {
  data: NonNullable<VisitBundle["gynecology"]>
  patientId: string
  visitId: string
  canEdit: boolean
}) {
  const t = useTranslations("gynecology")
  const g = useRecord({ table: "gynecology_visits", keyField: "visit_id", row: data.gvisit as GynecologyVisit, readOnly: !canEdit })
  return (
    <div className="space-y-3">
      <ConflictBanner rec={g} />
      <PaperSheet className="text-[14.5px] leading-relaxed">
        <h2 className="mb-5 text-[22px] font-bold">
          <span className="border-b-2 border-[color:var(--paper-line)] pb-0.5">Gynecology</span>
        </h2>
        <section id="gy-co" className="scroll-mt-48">
          <PaperLine label="C/O:" className="items-start">
            <MedicalTextarea id="field-complaint" rec={g} field="complaint" rows={2} label={t("complaint")} />
          </PaperLine>
        </section>
        <section id="gy-symptoms" className="mt-3 scroll-mt-48">
          <PaperHeading className="text-[16px]">Symptoms</PaperHeading>
          <div className="grid gap-2 sm:grid-cols-3">
            <MedicalYesNo rec={g} field="irregular_cycle" label="Irregular Cycle" />
            <MedicalYesNo rec={g} field="lap" label="LAP" />
            <MedicalYesNo rec={g} field="vaginitis" label="Vaginitis" />
          </div>
          <PaperLine label="Notes:" className="mt-1 items-start">
            <MedicalTextarea rec={g} field="symptom_notes" rows={2} label={t("symptomNotes")} />
          </PaperLine>
        </section>
        <PaperRule />
        <section id="gy-us" className="scroll-mt-48">
          <PaperHeading className="text-[16px]">Ultrasound</PaperHeading>
          <MedicalDrawingCanvas
            patientId={patientId}
            visitId={visitId}
            templateKey={data.gvisit?.ultrasound_template ?? "pelvis_v1"}
            initial={data.annotation}
            canEdit={canEdit}
          />
          <PaperLine label="Notes:" className="mt-2 items-start">
            <MedicalTextarea rec={g} field="ultrasound_notes" rows={2} label={t("usNotes")} />
          </PaperLine>
        </section>
        <PaperRule />
        <section id="gy-plan" className="scroll-mt-48">
          <PaperHeading>Plan</PaperHeading>
          <MedicalTextarea rec={g} field="plan" rows={3} label={t("plan")} />
        </section>
      </PaperSheet>
    </div>
  )
}
