"use client"

import Link from "next/link"
import { AppProvider } from "@/components/app-context"
import { FormSaveProvider } from "@/components/forms/save-state"
import { HistoryExamForm } from "@/components/medical/history-exam-form"
import { PregnancyCard } from "@/components/pregnancy/pregnancy-card"
import { OiChart } from "@/components/oi/oi-chart"
import { MedicalDrawingCanvas } from "@/components/medical/medical-drawing-canvas"
import { PrintConsent } from "@/components/print/print-views"
import { cycle, history, pregnancy, refs } from "./fixtures"

const FORMS = ["history", "pregnancy", "oi", "drawing", "consent"] as const

export function FormsPreview({ form }: { form: string }) {
  return (
    <AppProvider
      session={{ userId: "dev", email: null, fullName: "Preview", roleCode: null, roleNameEn: null, roleNameAr: null, permissions: [], doctorId: null, preferences: {} }}
      refs={refs}
    >
      <FormSaveProvider guard={false}>
        <div className="min-h-dvh bg-muted/40 p-4">
          <div className="no-print mx-auto mb-4 flex max-w-[297mm] flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Dev form preview (fixture data, not saved):</span>
            {FORMS.map((f) => (
              <Link key={f} href={`?form=${f}`} className={f === form ? "font-semibold text-primary underline" : "hover:underline"}>
                {f}
              </Link>
            ))}
          </div>
          {form === "history" && (
            <div className="mx-auto max-w-[210mm]">
              <HistoryExamForm data={history} canEditPatient canEditMedical canEditVisit />
            </div>
          )}
          {form === "pregnancy" && (
            <PregnancyCard
              pcase={pregnancy.pcase}
              followups={pregnancy.followups}
              patient={{ full_name: history.patient.full_name, age: 32, patient_code: history.patient.patient_code, wifeBlood: "A +", husbandBlood: "B +" }}
              editableRowIds={["fu2"]}
              canEditCase
              canCorrect
            />
          )}
          {form === "oi" && <OiChart bundle={cycle} canEdit />}
          {form === "drawing" && (
            <div className="paper mx-auto max-w-[210mm] p-6">
              <MedicalDrawingCanvas patientId="dev" visitId="dev" templateKey="pelvis_v1" initial={null} canEdit />
            </div>
          )}
          {form === "consent" && (
            <PrintConsent
              consent={{ technique: "icsi", surplus_embryos: "freeze", genetic_testing: false, consent_date: "2026-10-03" }}
              wife={history.patient.full_name}
              husband={history.husband.full_name ?? ""}
            />
          )}
        </div>
      </FormSaveProvider>
    </AppProvider>
  )
}
