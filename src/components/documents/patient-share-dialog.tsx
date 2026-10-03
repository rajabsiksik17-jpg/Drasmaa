"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Baby, CalendarDays, ClipboardList, FileHeart, FileText, FlaskConical, HeartPulse, History, Loader2, Stethoscope, type LucideIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCan } from "@/components/app-context"
import { ExportDialog, type ExportTarget } from "@/components/documents/export-dialog"
import { getShareTargets, type ShareTargets } from "@/lib/actions/generated-documents"
import { DOCUMENTS, type DocumentType } from "@/lib/documents/registry"
import { cn } from "@/lib/utils"

/** Patient profile → [Share]: choose what to export, then the usual export flow. */
export function PatientShareDialog({ patientId, open, onOpenChange }: { patientId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("export")
  const td = useTranslations("documentTypes")
  const can = useCan()
  const [targets, setTargets] = useState<ShareTargets | null>(null)
  const [chosen, setChosen] = useState<ExportTarget | null>(null)

  useEffect(() => {
    if (!open) return
    void getShareTargets(patientId).then((res) => res.ok && setTargets(res.data))
  }, [open, patientId])

  const options: { type: DocumentType; entityId: string | null; icon: LucideIcon; hint?: string }[] = targets
    ? [
        { type: "patient_summary", entityId: patientId, icon: ClipboardList },
        {
          type: targets.latestVisit?.type === "gynecology" ? "gynecology_visit" : "visit_summary",
          entityId: targets.latestVisit?.id ?? null,
          icon: Stethoscope,
          hint: t("latestVisit"),
        },
        { type: "investigations", entityId: targets.hasInvestigations ? patientId : null, icon: FlaskConical },
        { type: "pregnancy_summary", entityId: targets.pregnancyCase, icon: Baby },
        { type: "pregnancy_followup", entityId: targets.pregnancyCase, icon: FileHeart },
        { type: "fertility_summary", entityId: targets.fertilityCase, icon: FileText },
        { type: "oi_chart", entityId: targets.cycle, icon: HeartPulse },
        { type: "appointment_summary", entityId: targets.appointment, icon: CalendarDays },
        { type: "medical_history", entityId: patientId, icon: FileText },
        { type: "timeline", entityId: patientId, icon: History },
      ]
    : []
  const visible = options.filter((o) => DOCUMENTS[o.type].permissions.every((p) => can(p)))

  return (
    <>
      <Dialog open={open && !chosen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("shareTitle")}</DialogTitle>
            <DialogDescription>{t("shareHint")}</DialogDescription>
          </DialogHeader>
          {!targets ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {visible.map((o) => (
                <li key={o.type}>
                  <button
                    type="button"
                    disabled={!o.entityId}
                    onClick={() => o.entityId && setChosen({ type: o.type, entityId: o.entityId, patientId })}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border p-3 text-start transition",
                      o.entityId ? "hover:border-primary hover:bg-primary/[0.04]" : "cursor-not-allowed opacity-45",
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <o.icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{td(o.type)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{o.entityId ? (o.hint ?? t("ready")) : t("notAvailable")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      {chosen && (
        <ExportDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setChosen(null)
              onOpenChange(false)
            }
          }}
          target={chosen}
        />
      )}
    </>
  )
}
