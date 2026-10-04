"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { Baby, FlaskConical, Loader2, Stethoscope, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useActionError } from "@/hooks/use-action-error"
import { createPregnancyCase, startVisit } from "@/lib/actions/clinical"
import { cn } from "@/lib/utils"
import type { VisitType } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

const TYPES: { type: VisitType; icon: LucideIcon; tone: string }[] = [
  { type: "pregnancy", icon: Baby, tone: "text-rose-600 bg-rose-500/10 dark:text-rose-300" },
  { type: "fertility", icon: FlaskConical, tone: "text-primary bg-primary/10" },
  { type: "gynecology", icon: Stethoscope, tone: "text-violet-600 bg-violet-500/10 dark:text-violet-300" },
]

export function appointmentTypeToVisit(visitType: string | null | undefined): VisitType | null {
  if (!visitType) return null
  if (visitType === "pregnancy") return "pregnancy"
  if (visitType === "fertility" || visitType === "oi_followup") return "fertility"
  if (visitType === "gynecology") return "gynecology"
  return null
}

/** "New Visit" → choose Pregnancy & Delivery / Fertility / Gynecology. */
export function StartVisitDialog({
  open,
  onOpenChange,
  patientId,
  appointmentId,
  encounterId,
  suggested,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  appointmentId?: string | null
  /** Today's clinic visit the medical visit belongs to (queue). */
  encounterId?: string | null
  suggested?: VisitType | null
}) {
  const t = useTranslations("visits")
  const router = useRouter()
  const { message } = useActionError()
  const [pending, startTransition] = useSafeTransition()
  const [busyType, setBusyType] = useState<VisitType | null>(null)
  const [askPregnancy, setAskPregnancy] = useState(false)

  const begin = (type: VisitType, caseId?: string) => {
    setBusyType(type)
    startTransition(async () => {
      const res = await startVisit({ patientId, visitType: type, appointmentId: appointmentId ?? null, caseId: caseId ?? null, encounterId: encounterId ?? null })
      if (!res.ok) {
        if (res.error.code === "pregnancyCaseRequired") {
          setAskPregnancy(true)
          return
        }
        toast.error(message(res.error, "startVisit"))
        setBusyType(null)
        return
      }
      onOpenChange(false)
      router.push(`/patients/${patientId}/visits/${res.data.visitId}`)
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("selectType")}</DialogTitle>
            <DialogDescription>{t("selectTypeHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            {TYPES.map(({ type, icon: Icon, tone }, i) => (
              <motion.button
                key={type}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.98 }}
                disabled={pending}
                onClick={() => begin(type)}
                className={cn(
                  "relative flex flex-col items-center gap-3 rounded-xl border p-5 text-center transition hover:border-primary/50 hover:shadow-sm disabled:opacity-60",
                  suggested === type && "border-primary ring-3 ring-primary/15",
                )}
              >
                <span className={cn("grid size-12 place-items-center rounded-full", tone)}>
                  {busyType === type && pending ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
                </span>
                <span className="text-sm font-semibold">{t(`type.${type}`)}</span>
                {suggested === type && (
                  <span className="absolute top-2 end-2 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                    {t("fromAppointment")}
                  </span>
                )}
              </motion.button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={askPregnancy} onOpenChange={(o) => { setAskPregnancy(o); if (!o) setBusyType(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("createPregnancyTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("createPregnancyBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                startTransition(async () => {
                  const res = await createPregnancyCase({ patientId })
                  if (!res.ok) {
                    toast.error(message(res.error))
                    return
                  }
                  toast.success(t("pregnancyCreated", { number: res.data.case_number }))
                  setAskPregnancy(false)
                  begin("pregnancy", res.data.id)
                })
              }}
            >
              {t("createPregnancyConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
