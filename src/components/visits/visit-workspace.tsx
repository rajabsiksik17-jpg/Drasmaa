"use client"

import { ExportMenu } from "@/components/documents/export-menu"
import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import {
  Ban,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  TestTube2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { FormSaveProvider, SaveIndicator, useSaveRegistry } from "@/components/forms/save-state"
import { CorrectionProvider } from "@/components/forms/correction-context"
import { CollapsibleSection } from "@/components/common/collapsible-section"
import { VisitStatusBadge } from "@/components/common/status-badge"
import { HistoryExamForm, HISTORY_SECTIONS, type HistoryExamData } from "@/components/medical/history-exam-form"
import { SectionNavigation } from "@/components/medical/paper"
import { FertilityForm } from "@/components/visits/fertility-form"
import { GynecologyForm } from "@/components/visits/gynecology-form"
import { PregnancyCard } from "@/components/pregnancy/pregnancy-card"
import { VisitInvestigations, VisitResultsProvider } from "@/components/visits/visit-results"
import { PatientTimeline } from "@/components/patients/patient-timeline"
import { AppointmentDialog } from "@/components/appointments/appointment-dialog"
import { useRecord } from "@/hooks/use-record"
import { useLocalPreference } from "@/hooks/use-local-preference"
import { useActionError } from "@/hooks/use-action-error"
import { cancelVisit, completeVisit, missingVisitFields } from "@/lib/actions/clinical"
import { ageFromDob, formatDate, formatDateTime } from "@/lib/dates"
import type { VisitBundle } from "@/lib/data/visit"
import type { Patient, TimelineEvent } from "@/types/db"

export interface VisitPerms {
  editVisit: boolean
  editType: boolean
  complete: boolean
  correct: boolean
  editPatient: boolean
  editMedical: boolean
  investigations: boolean
  oi: boolean
  upload: boolean
  viewDocuments: boolean
}

export function VisitWorkspace(props: {
  patient: { id: string; full_name: string; patient_code: string }
  bundle: VisitBundle
  history: Omit<HistoryExamData, "visit" | "visitDate"> | null
  timeline: TimelineEvent[]
  perms: VisitPerms
  /** Server-rendered sections (ultrasound images & drawings, prescription, billing). */
  extras?: React.ReactNode
  extraSections?: { id: string; label: string }[]
}) {
  const t = useTranslations("visits")
  const v = props.bundle.visit
  return (
    <FormSaveProvider>
      <CorrectionProvider
        historical={v.status === "completed"}
        canCorrect={props.perms.correct && v.status === "completed"}
        label={v.status === "completed" ? t("completedLocked", { date: formatDateTime(v.completed_at) }) : undefined}
      >
        <VisitWorkspaceInner {...props} />
      </CorrectionProvider>
    </FormSaveProvider>
  )
}

const PANEL_KEY = "ui.visit.historyPanel"

function VisitWorkspaceInner({
  patient,
  bundle,
  history,
  timeline,
  perms,
  extras,
  extraSections = [],
}: {
  patient: { id: string; full_name: string; patient_code: string }
  bundle: VisitBundle
  history: Omit<HistoryExamData, "visit" | "visitDate"> | null
  timeline: TimelineEvent[]
  perms: VisitPerms
  extras?: React.ReactNode
  extraSections?: { id: string; label: string }[]
}) {
  const t = useTranslations("visits")
  const ts = useTranslations("historyExam.sections")
  const tf = useTranslations("fields")
  const locale = useLocale()
  const router = useRouter()
  const registry = useSaveRegistry()
  const { showError } = useActionError()
  const [pending, start] = useTransition()
  const [missing, setMissing] = useState<string[] | null>(null)
  const [followUp, setFollowUp] = useState(false)
  const [askFollowUp, setAskFollowUp] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [panel, setPanel] = useLocalPreference(PANEL_KEY, () => true)
  const v = bundle.visit
  const open = v.status === "draft" || v.status === "in_progress"
  const cancelled = v.status === "cancelled"
  const editable = (perms.editVisit || perms.editType) && !cancelled
  const togglePanel = () => setPanel(!panel)

  // One shared controller for the patient row (H&E + fertility marriage date).
  const patientRec = useRecord({
    table: "patients",
    keyField: "id",
    row: (history?.patient ?? { id: patient.id, version: 0 }) as Patient,
    readOnly: !perms.editPatient || !history,
    realtime: !!history,
  })

  const sections = [
    ...HISTORY_SECTIONS.map((id) => ({ id, label: ts(id) })),
    ...(v.visit_type === "fertility"
      ? [
          { id: "fx-marital", label: t("sec.marital") },
          { id: "fx-panels", label: t("sec.panels") },
          { id: "fx-plan", label: t("sec.plan") },
        ]
      : v.visit_type === "gynecology"
        ? [
            { id: "gy-co", label: "C/O" },
            { id: "gy-us", label: t("sec.ultrasound") },
            { id: "gy-plan", label: t("sec.plan") },
          ]
        : [{ id: "pg-card", label: t("sec.followup") }]),
    { id: "vx-investigations", label: t("sec.investigations") },
    ...extraSections,
  ]

  const fieldTarget: Record<string, string> = {
    blood_pressure: (() => {
      const row = bundle.pregnancy?.followups.find((f) => f.visit_id === v.id)
      return row ? `bp-${row.id}` : "pg-card"
    })(),
    followup_date: "pg-card",
    plan_primary: "fx-plan",
    complaint: "field-complaint",
  }

  const goToField = (field: string) => {
    setMissing(null)
    const el = document.getElementById(fieldTarget[field] ?? field)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    setTimeout(() => (el.matches("input,textarea,select") ? el : el.querySelector<HTMLElement>("input,textarea,select"))?.focus(), 400)
  }

  const complete = () =>
    start(async () => {
      const flushed = (await registry?.flushAll()) ?? true
      if (!flushed) {
        toast.error(t("saveBeforeComplete"))
        return
      }
      const check = await missingVisitFields(v.id)
      if (check.ok && check.data.length) {
        setMissing(check.data)
        return
      }
      const res = await completeVisit(v.id)
      if (!res.ok) {
        if (res.error.code === "missingFields" && res.error.fields) return setMissing(res.error.fields)
        return showError(res.error)
      }
      toast.success(t("completed"))
      setAskFollowUp(true)
      router.refresh()
    })

  const historyPanel = (
    <aside className="no-print space-y-4">
      <div className="rounded-xl border bg-card p-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-muted-foreground" />
          {t("historyPanel")}
        </h3>
        <PatientTimeline patientId={patient.id} events={timeline} compact />
      </div>
      {bundle.fertility && bundle.fertility.previousVisits.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold">{t("previousFertilityVisits")}</h3>
          <ul className="space-y-1 text-sm">
            {bundle.fertility.previousVisits.map((p) => (
              <li key={p.id}>
                <Link href={`/patients/${patient.id}/visits/${p.id}`} className="flex items-center justify-between hover:text-primary">
                  {formatDate(p.visit_date)}
                  <VisitStatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )

  return (
    <div className="space-y-4 pb-24">
      {/* Visit context */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{t(`type.${v.visit_type}`)}</h2>
            <VisitStatusBadge status={v.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(v.visit_date)}
            {v.doctor && ` · ${locale === "ar" ? (v.doctor.display_name_ar ?? v.doctor.display_name_en) : v.doctor.display_name_en}`}
            {v.patient_age_years != null && ` · ${t("ageAtVisit", { age: v.patient_age_years })}`}
            {` · ${t("formVersion", { code: v.form_code, version: v.form_version })}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="no-print hidden xl:inline-flex" onClick={togglePanel}>
          {panel ? <PanelLeftClose className="rtl:-scale-x-100" /> : <PanelLeftOpen className="rtl:-scale-x-100" />}
          {t("historyPanel")}
        </Button>
        <ExportMenu
          className="no-print"
          target={{ type: v.visit_type === "gynecology" ? "gynecology_visit" : "visit_summary", entityId: v.id, patientId: v.patient_id }}
        />
        <Button variant="outline" size="sm" asChild className="no-print">
          <a href={`/print/visit/${v.id}`} target="_blank" rel="noopener">
            <Printer />
            {t("print")}
          </a>
        </Button>
        {open && perms.editVisit && (
          <Button variant="ghost" size="sm" className="no-print text-destructive" onClick={() => setCancelOpen(true)}>
            <Ban />
            {t("cancelVisit")}
          </Button>
        )}
      </div>

      <div className={panel ? "grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]" : "grid gap-5 lg:grid-cols-[170px_minmax(0,1fr)]"}>
        {panel ? (
          <div className="hidden xl:block xl:sticky xl:top-[13rem] xl:max-h-[calc(100dvh-14rem)] xl:self-start xl:overflow-y-auto">{historyPanel}</div>
        ) : (
          <div className="lg:sticky lg:top-[13rem] lg:self-start">
            <SectionNavigation sections={sections} />
          </div>
        )}

        <div className="min-w-0 space-y-6">
          {panel && (
            <div className="xl:hidden">
              <SectionNavigation sections={sections} />
            </div>
          )}

          {history && (
            <CollapsibleSection title={t("historyExam")} icon={ClipboardList} defaultOpen>
              <HistoryExamForm
                data={{ ...history, visit: bundle.clinical, visitDate: v.visit_date }}
                canEditPatient={perms.editPatient && !cancelled}
                canEditMedical={perms.editMedical && !cancelled}
                canEditVisit={perms.editVisit && !cancelled}
                patientRec={patientRec}
              />
            </CollapsibleSection>
          )}

          <VisitResultsProvider
            patientId={patient.id}
            visitId={v.id}
            initial={bundle.results}
            previous={bundle.previousResults}
            readOnly={!perms.investigations || cancelled}
          >
            <CollapsibleSection title={t(`form.${v.visit_type}`)} icon={FileText} defaultOpen>
              {v.visit_type === "fertility" && bundle.fertility?.visit && (
                <FertilityForm
                  patientRec={patientRec}
                  data={bundle.fertility}
                  patientId={patient.id}
                  visitId={v.id}
                  canEdit={perms.editType && !cancelled}
                  canOi={perms.oi}
                  canUpload={perms.upload}
                />
              )}
              {v.visit_type === "gynecology" && bundle.gynecology?.gvisit && (
                <GynecologyForm data={bundle.gynecology} patientId={patient.id} visitId={v.id} canEdit={perms.editType && !cancelled} />
              )}
              {v.visit_type === "pregnancy" && bundle.pregnancy?.pcase && history && (
                <div id="pg-card" className="scroll-mt-48">
                  <PregnancyCard
                    pcase={bundle.pregnancy.pcase}
                    followups={bundle.pregnancy.followups}
                    patient={{
                      full_name: patient.full_name,
                      age: ageFromDob(history.patient.dob),
                      patient_code: patient.patient_code,
                      wifeBlood: [history.patient.blood_group, history.patient.rh].filter(Boolean).join(" "),
                      husbandBlood: [history.husband?.blood_group, history.husband?.rh].filter(Boolean).join(" "),
                    }}
                    editableRowIds={open ? bundle.pregnancy.followups.filter((f) => f.visit_id === v.id).map((f) => f.id) : []}
                    canEditCase={perms.editType && !cancelled}
                    canCorrect={perms.correct}
                  />
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection id="vx-investigations" title={t("sec.investigations")} icon={TestTube2} defaultOpen={bundle.investigations.length > 0}>
              <div className="paper rounded p-3">
                <VisitInvestigations
                  context={v.visit_type}
                  patientId={patient.id}
                  visitId={v.id}
                  investigations={bundle.investigations}
                  canEdit={perms.investigations && !cancelled}
                />
              </div>
            </CollapsibleSection>
          </VisitResultsProvider>
          {extras}
        </div>
      </div>

      {/* Sticky action bar: save state + completion always within reach */}
      <div className="no-print sticky bottom-16 z-20 md:bottom-4">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur"
        >
          <span className="text-sm font-medium">
            {patient.full_name} · {t(`type.${v.visit_type}`)}
          </span>
          <SaveIndicator className="me-auto" />
          {!cancelled && perms.editVisit && (
            <Button variant="outline" size="sm" onClick={() => setFollowUp(true)}>
              <CalendarPlus />
              <span className="hidden sm:inline">{t("scheduleFollowUp")}</span>
            </Button>
          )}
          {open && perms.complete && editable && (
            <Button size="sm" onClick={complete} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {t("complete")}
            </Button>
          )}
        </motion.div>
      </div>

      {/* Missing required fields */}
      <Dialog open={!!missing} onOpenChange={(o) => !o && setMissing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("missingTitle")}</DialogTitle>
            <DialogDescription>{t("missingBody")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            <AnimatePresence>
              {missing?.map((f) => (
                <motion.li key={f} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span>{t("isRequired", { field: tf.has(f) ? tf(f) : f })}</span>
                  <Button size="sm" variant="outline" onClick={() => goToField(f)}>
                    {t("goToField")}
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </DialogContent>
      </Dialog>

      {/* After completion */}
      <Dialog open={askFollowUp} onOpenChange={setAskFollowUp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" />
              {t("completedTitle")}
            </DialogTitle>
            <DialogDescription>{t("followUpQuestion")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" asChild>
              <Link href={`/patients/${patient.id}`}>{t("backToPatient")}</Link>
            </Button>
            <Button
              onClick={() => {
                setAskFollowUp(false)
                setFollowUp(true)
              }}
            >
              <CalendarPlus />
              {t("scheduleFollowUp")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {followUp && (
        <AppointmentDialog
          open={followUp}
          onOpenChange={setFollowUp}
          patient={patient}
          sourceVisitId={v.id}
          defaults={{
            doctor_id: v.doctor_id ?? undefined,
            department_id: v.department_id ?? undefined,
            visit_type: v.visit_type === "fertility" && bundle.fertility?.activeCycle ? "oi_followup" : v.visit_type,
          }}
        />
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
            <DialogDescription>{t("cancelBody")}</DialogDescription>
          </DialogHeader>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder={t("cancelReason")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {t("keepVisit")}
            </Button>
            <Button
              variant="destructive"
              disabled={cancelReason.trim().length < 3 || pending}
              onClick={() =>
                start(async () => {
                  const res = await cancelVisit(v.id, cancelReason)
                  if (!res.ok) return showError(res.error)
                  setCancelOpen(false)
                  toast.success(t("cancelled"))
                  router.push(`/patients/${patient.id}`)
                })
              }
            >
              {t("confirmCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
