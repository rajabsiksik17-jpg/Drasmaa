"use client"

import { useTranslations } from "next-intl"
import { Printer } from "lucide-react"
import { ExportMenu } from "@/components/documents/export-menu"
import { Button } from "@/components/ui/button"
import { FormSaveProvider, SaveIndicator } from "@/components/forms/save-state"
import { HISTORY_SECTIONS, HistoryExamForm, type HistoryExamData } from "@/components/medical/history-exam-form"
import { SectionNavigation } from "@/components/medical/paper"

/** Patient-level History & Examination: paper sheet + section nav + save status. */
export function HistoryExamWorkspace({
  data,
  canEditPatient,
  canEditMedical,
  printHref,
}: {
  data: HistoryExamData
  canEditPatient: boolean
  canEditMedical: boolean
  printHref: string
}) {
  const t = useTranslations("historyExam")
  const ts = useTranslations("historyExam.sections")
  const sections = HISTORY_SECTIONS.map((id) => ({ id, label: ts(id) }))
  return (
    <FormSaveProvider>
      <div className="grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-[13rem] lg:self-start">
          <SectionNavigation sections={sections} />
        </div>
        <div className="min-w-0 space-y-3">
          <div className="no-print flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t("masterHint")}</p>
            <div className="flex items-center gap-3">
              <SaveIndicator />
              <ExportMenu target={{ type: "medical_history", entityId: data.patient.id, patientId: data.patient.id }} />
              <Button variant="outline" size="sm" asChild>
                <a href={printHref} target="_blank" rel="noopener">
                  <Printer />
                  {t("print")}
                </a>
              </Button>
            </div>
          </div>
          <HistoryExamForm data={data} canEditPatient={canEditPatient} canEditMedical={canEditMedical} />
        </div>
      </div>
    </FormSaveProvider>
  )
}
