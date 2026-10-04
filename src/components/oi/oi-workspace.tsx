"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { CheckCircle2, HeartPulse, Loader2, Printer, XCircle } from "lucide-react"
import { ExportMenu } from "@/components/documents/export-menu"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { FormSaveProvider, SaveIndicator, useSaveRegistry } from "@/components/forms/save-state"
import { CorrectionProvider } from "@/components/forms/correction-context"
import { CaseStatusBadge } from "@/components/common/status-badge"
import { OiChart } from "@/components/oi/oi-chart"
import { useActionError } from "@/hooks/use-action-error"
import { saveRecord } from "@/lib/actions/records"
import { formatDate, formatDateTime, isoToClinicParts } from "@/lib/dates"
import type { CycleBundle } from "@/lib/data/cycle"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export function OiWorkspace({
  patientId,
  bundle,
  canEdit,
  canCorrect,
}: {
  patientId: string
  bundle: CycleBundle
  canEdit: boolean
  canCorrect: boolean
}) {
  const t = useTranslations("oi")
  const c = bundle.cycle
  const historical = c.status !== "active"
  return (
    <FormSaveProvider>
      <CorrectionProvider
        historical={historical}
        canCorrect={canCorrect}
        label={c.status === "completed" ? t("completedLocked", { date: formatDateTime(c.completed_at) }) : t("cancelledLocked")}
      >
        <Toolbar patientId={patientId} bundle={bundle} canEdit={canEdit} />
        <OiChart bundle={bundle} canEdit={canEdit} />
      </CorrectionProvider>
    </FormSaveProvider>
  )
}

function Toolbar({ patientId, bundle, canEdit }: { patientId: string; bundle: CycleBundle; canEdit: boolean }) {
  const t = useTranslations("oi")
  const router = useRouter()
  const registry = useSaveRegistry()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [confirm, setConfirm] = useState<null | "completed" | "cancelled">(null)
  const c = bundle.cycle

  const finish = (status: "completed" | "cancelled") =>
    start(async () => {
      await registry?.flushAll()
      // The patch only touches `status`, so after our own autosaves bumped the
      // version it is safe to retry once against the latest version.
      let res = await saveRecord({ table: "fertility_cycles", key: c.id, patch: { status }, expectedVersion: c.version })
      if (!res.ok && res.error.code === "conflict" && res.latest) {
        res = await saveRecord({ table: "fertility_cycles", key: c.id, patch: { status }, expectedVersion: res.latest.version as number })
      }
      if (!res.ok) {
        showError(res.error)
        router.refresh()
        return
      }
      toast.success(status === "completed" ? t("completed") : t("cancelled"))
      router.refresh()
    })

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
      <HeartPulse className="size-5 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{t("title", { number: c.cycle_number })}</h2>
          <CaseStatusBadge status={c.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("startedOn", { date: formatDate(isoToClinicParts(c.started_at).date) })} · {t("formVersion", { version: c.form_version })}
          {bundle.otherCycles.length > 0 && (
            <>
              {" · "}
              {t("otherCycles")}{" "}
              {bundle.otherCycles.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ", "}
                  <Link href={`/patients/${patientId}/cycles/${o.id}`} className="text-primary hover:underline">
                    #{o.cycle_number}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
      </div>
      <SaveIndicator />
      <ExportMenu target={{ type: "oi_chart", entityId: c.id, patientId }} />
      <Button variant="outline" size="sm" asChild>
        <a href={`/print/cycle/${c.id}`} target="_blank" rel="noopener">
          <Printer />
          {t("print")}
        </a>
      </Button>
      {c.status === "active" && canEdit && (
        <>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirm("cancelled")} disabled={pending}>
            <XCircle />
            {t("cancelCycle")}
          </Button>
          <Button size="sm" onClick={() => setConfirm("completed")} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {t("completeCycle")}
          </Button>
        </>
      )}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "completed" ? t("completeTitle") : t("cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "completed" ? t("completeBody") : t("cancelBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const s = confirm
                setConfirm(null)
                if (s) finish(s)
              }}
            >
              {t("continue")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
