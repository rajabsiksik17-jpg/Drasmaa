"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Baby, FlaskConical, HeartPulse, Loader2, Lock, Stethoscope } from "lucide-react"
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
import { StartVisitDialog } from "@/components/visits/start-visit-dialog"
import { useActionError } from "@/hooks/use-action-error"
import { closeCase, createFertilityCase, createPregnancyCase, startOiCycle } from "@/lib/actions/clinical"
import type { VisitType } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export function NewVisitButton({ patientId, type, label, size = "sm" }: { patientId: string; type: VisitType; label: string; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <Stethoscope />
        {label}
      </Button>
      {open && <StartVisitDialog open onOpenChange={setOpen} patientId={patientId} suggested={type} />}
    </>
  )
}

export function NewCaseButton({ patientId, kind }: { patientId: string; kind: "fertility" | "pregnancy" }) {
  const t = useTranslations("cases")
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = kind === "fertility" ? await createFertilityCase(patientId) : await createPregnancyCase({ patientId })
          if (!res.ok) return showError(res.error)
          toast.success(t(kind === "fertility" ? "fertilityCreated" : "pregnancyCreated", { number: res.data.case_number }))
          if (kind === "pregnancy") router.push(`/patients/${patientId}/pregnancies/${res.data.id}`)
          else router.refresh()
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : kind === "fertility" ? <FlaskConical /> : <Baby />}
      {t(kind === "fertility" ? "newFertility" : "newPregnancy")}
    </Button>
  )
}

export function StartCycleButton({ patientId, caseId }: { patientId: string; caseId: string }) {
  const t = useTranslations("cases")
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await startOiCycle({ fertilityCaseId: caseId })
          if (!res.ok) return showError(res.error)
          router.push(`/patients/${patientId}/cycles/${res.data.id}`)
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <HeartPulse />}
      {t("startCycle")}
    </Button>
  )
}

export function CloseCaseButton({ caseId, kind }: { caseId: string; kind: "fertility" | "pregnancy" }) {
  const t = useTranslations("cases")
  const router = useRouter()
  const { showError } = useActionError()
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState("")
  const [pending, start] = useSafeTransition()
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Lock />
        {t("close")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("closeTitle")}</DialogTitle>
            <DialogDescription>{t("closeBody")}</DialogDescription>
          </DialogHeader>
          <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={kind === "pregnancy" ? t("outcome") : t("closeReason")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await closeCase({ kind, caseId, outcome: outcome || null, reason: outcome || null })
                  if (!res.ok) return showError(res.error)
                  setOpen(false)
                  toast.success(t("closed"))
                  router.refresh()
                })
              }
            >
              {t("confirmClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
