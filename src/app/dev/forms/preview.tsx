"use client"

import Link from "next/link"
import { AppProvider } from "@/components/app-context"
import { FormSaveProvider } from "@/components/forms/save-state"
import { HistoryExamForm } from "@/components/medical/history-exam-form"
import { PregnancyCard } from "@/components/pregnancy/pregnancy-card"
import { OiChart } from "@/components/oi/oi-chart"
import { MedicalDrawingCanvas } from "@/components/medical/medical-drawing-canvas"
import { PrintConsent } from "@/components/print/print-views"
import { PatientHeader } from "@/components/patients/patient-header"
import { QueueBoard } from "@/components/encounters/queue-board"
import { DrawingEditor } from "@/components/drawings/drawing-editor"
import { P } from "@/lib/permissions"
import { DashboardQuickActions } from "@/components/dashboard/quick-actions"
import { UnifiedTimeline } from "@/components/patients/unified-timeline"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { BillLinesEditor } from "@/components/accounting/bill-lines-editor"
import { WalkInDialog } from "@/components/encounters/walk-in-dialog"
import { AppointmentList } from "@/components/appointments/appointment-list"
import { appointments, billLines, cycle, history, patientCtx, pregnancy, queue, refs, timeline } from "./fixtures"

const FORMS = ["history", "pregnancy", "oi", "drawing", "consent", "header", "queue", "editor", "quick", "timeline", "upload", "bill", "walkin", "appointments"] as const
// Front-desk + doctor + billing rights, to show every action of the new screens.
const PREVIEW_PERMISSIONS = Object.values(P)

export function FormsPreview({ form }: { form: string }) {
  return (
    <AppProvider
      session={{ userId: "dev", email: null, fullName: "Preview", roleCode: null, roleNameEn: null, roleNameAr: null, permissions: ["header", "queue", "editor", "quick", "timeline", "upload", "bill", "walkin", "appointments"].includes(form) ? PREVIEW_PERMISSIONS : [], doctorId: null, preferences: {} }}
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
          {form === "header" && (
            <div className="mx-auto max-w-6xl bg-background px-4 pt-14 sm:px-6 lg:px-8">
              <PatientHeader ctx={patientCtx} />
              <div className="h-[150vh] p-4 text-sm text-muted-foreground">Scroll to see the compact header.</div>
            </div>
          )}
          {form === "queue" && (
            <div className="mx-auto max-w-7xl">
              <QueueBoard rows={queue} prepay />
            </div>
          )}
          {form === "quick" && (
            <div className="mx-auto max-w-5xl">
              <DashboardQuickActions />
            </div>
          )}
          {form === "timeline" && (
            <div className="mx-auto max-w-3xl rounded-xl border bg-card p-4">
              <UnifiedTimeline patientId="dev" events={timeline} people={{}} />
            </div>
          )}
          {form === "bill" && (
            <div className="mx-auto max-w-3xl rounded-xl border bg-card p-3">
              <BillLinesEditor invoiceId="dev-invoice" currency="JOD" paymentType="cash" lines={billLines} editable />
            </div>
          )}
          {form === "walkin" && <WalkInDialog open onOpenChange={() => undefined} />}
          {form === "appointments" && (
            <div className="mx-auto max-w-6xl">
              <AppointmentList rows={appointments} />
            </div>
          )}
          {form === "upload" && <UploadDialog open onOpenChange={() => undefined} links={{ patientId: "dev", visitId: "dev-visit" }} />}
          {form === "editor" && (
            <div className="mx-auto max-w-4xl bg-background p-3">
              <DrawingEditor
                drawing={{
                  id: "dev-drawing", patient_id: "dev", visit_id: "dev", image_id: null, template_key: "pelvis_v1", context: "gynecology", title: null, notes: "",
                  shapes: [
                    { id: "c1", type: "circle", x: 380, y: 300, w: 120, h: 90, color: "#e11d2e", size: 4 },
                    { id: "a1", type: "arrow", points: [200, 150, 360, 290], color: "#1d4ed8", size: 4 },
                    { id: "t1", type: "text", x: 520, y: 300, text: "Left ovary cyst 3cm", color: "#111827", size: 24, rotation: 0 },
                  ],
                  canvas_width: 1000, canvas_height: 700, preview_path: null, saved_versions: 0, status: "active",
                  version: 1, created_at: "2026-10-04T08:00:00Z", updated_at: "2026-10-04T08:00:00Z", created_by: null, updated_by: null,
                }}
                background="/templates/pelvis_v1.svg"
                canEdit
                visitCompleted={false}
              />
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
