"use client"

import { useTranslations } from "next-intl"
import { FormSaveProvider, SaveIndicator } from "@/components/forms/save-state"
import { CorrectionProvider } from "@/components/forms/correction-context"
import { PregnancyCard, type PregnancyCardPatient } from "@/components/pregnancy/pregnancy-card"
import type { PregnancyCase, PregnancyFollowup } from "@/types/db"

export function PregnancyCaseWorkspace(props: {
  pcase: PregnancyCase
  followups: PregnancyFollowup[]
  patient: PregnancyCardPatient
  editableRowIds: string[]
  canEditCase: boolean
  canCorrect: boolean
  historical: boolean
}) {
  const t = useTranslations("pregnancy")
  return (
    <FormSaveProvider>
      <CorrectionProvider historical={props.historical} canCorrect={props.canCorrect} label={t("closedLocked")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t("rowsHint")}</p>
          <SaveIndicator />
        </div>
        <PregnancyCard
          pcase={props.pcase}
          followups={props.followups}
          patient={props.patient}
          editableRowIds={props.historical ? [] : props.editableRowIds}
          canEditCase={props.canEditCase}
          canCorrect={props.canCorrect}
        />
      </CorrectionProvider>
    </FormSaveProvider>
  )
}
