"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { BellRing, Wallet, CalendarClock, CircleSlash, FileDown, Loader2, LogIn, Mail, MessageCircle, MoreHorizontal, Play, Undo2, UserRound, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { AppointmentDialog } from "@/components/appointments/appointment-dialog"
import { StartVisitDialog, appointmentTypeToVisit } from "@/components/visits/start-visit-dialog"
import { MessageComposer, type ComposerChannel } from "@/components/messaging/message-composer"
import { ExportDialog } from "@/components/documents/export-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCan, useSession } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { setAppointmentStatus } from "@/lib/actions/appointments"
import { openAppointmentInvoice } from "@/lib/actions/accounting"
import { P } from "@/lib/permissions"
import type { AppointmentStatus, AppointmentWithRefs } from "@/types/db"

/** Context-aware actions for one appointment (role + status dependent). */
export function AppointmentActions({ appointment, compact = false }: { appointment: AppointmentWithRefs; compact?: boolean }) {
  const t = useTranslations("appointments")
  const can = useCan()
  const session = useSession()
  const router = useRouter()
  const { message } = useActionError()
  const [pending, startTransition] = useTransition()
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [visitOpen, setVisitOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [compose, setCompose] = useState<{ channel: ComposerChannel; purpose: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const a = appointment
  const isDoctor = !!session.doctorId && can(P.visitsCreate)
  const active = a.status === "scheduled" || a.status === "checked_in"

  const change = (status: Exclude<AppointmentStatus, "rescheduled">, why?: string) =>
    startTransition(async () => {
      const res = await setAppointmentStatus({ id: a.id, status, expectedVersion: a.version, reason: why ?? null })
      if (!res.ok) {
        toast.error(message(res.error))
        router.refresh()
        return
      }
      toast.success(t(`statusChanged.${status}`, { patient: a.patient?.full_name ?? "" }))
      router.refresh()
    })

  let primary: React.ReactNode = null
  if (a.status === "scheduled" && can(P.appointmentsCheckin)) {
    primary = (
      <Button size="sm" onClick={() => change("checked_in")} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <LogIn className="rtl:-scale-x-100" />}
        {!compact && t("checkIn")}
      </Button>
    )
  } else if ((a.status === "scheduled" || a.status === "checked_in") && isDoctor) {
    primary = (
      <Button size="sm" onClick={() => setVisitOpen(true)} disabled={pending}>
        <Play className="rtl:-scale-x-100" />
        {!compact && t("startVisit")}
      </Button>
    )
  } else if (a.status === "with_doctor" && isDoctor) {
    primary = (
      <Button size="sm" variant="secondary" onClick={() => setVisitOpen(true)}>
        <Play className="rtl:-scale-x-100" />
        {!compact && t("continueVisit")}
      </Button>
    )
  }

  const checkout = () =>
    startTransition(async () => {
      const res = await openAppointmentInvoice(a.id)
      if (!res.ok) return void toast.error(message(res.error))
      router.push(`/accounting/invoices/${res.data.id}`)
    })
  const canWhatsapp = can(P.messagesPrepareWhatsapp)
  const canEmail = can(P.messagesSendEmail)
  const reminderPurpose =
    a.status === "cancelled" ? "appointment_cancelled" : a.status === "rescheduled" ? "appointment_rescheduled" : "appointment_reminder"

  return (
    <div className="flex items-center justify-end gap-1.5">
      {primary}
      {active && canWhatsapp && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-[#128C7E] hover:bg-[#25D366]/10 hover:text-[#0f7a6e]"
              onClick={() => setCompose({ channel: "whatsapp", purpose: "appointment_reminder" })}
              aria-label={t("whatsappReminder")}
            >
              <MessageCircle />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("whatsappReminder")}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t("more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={`/patients/${a.patient_id}`}>
              <UserRound />
              {t("openPatient")}
            </Link>
          </DropdownMenuItem>
          {(canWhatsapp || canEmail) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCompose({ channel: canWhatsapp ? "whatsapp" : "email", purpose: reminderPurpose })}>
                <BellRing />
                {t("reminder")}
              </DropdownMenuItem>
              {canWhatsapp && (
                <DropdownMenuItem onSelect={() => setCompose({ channel: "whatsapp", purpose: reminderPurpose })}>
                  <MessageCircle />
                  {t("whatsapp")}
                </DropdownMenuItem>
              )}
              {canEmail && (
                <DropdownMenuItem onSelect={() => setCompose({ channel: "email", purpose: reminderPurpose })}>
                  <Mail />
                  {t("email")}
                </DropdownMenuItem>
              )}
            </>
          )}
          {can(P.accountingCreate) && a.status !== "cancelled" && a.status !== "rescheduled" && (
            <DropdownMenuItem onSelect={checkout}>
              <Wallet />
              {t("checkout")}
            </DropdownMenuItem>
          )}
          {can(P.documentsGenerate) && (
            <DropdownMenuItem onSelect={() => setExportOpen(true)}>
              <FileDown />
              {t("exportAppointment")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {a.status === "checked_in" && can(P.appointmentsCheckin) && (
            <DropdownMenuItem onSelect={() => change("scheduled")}>
              <Undo2 />
              {t("undoCheckIn")}
            </DropdownMenuItem>
          )}
          {active && can(P.appointmentsEdit) && (
            <DropdownMenuItem onSelect={() => setRescheduleOpen(true)}>
              <CalendarClock />
              {t("reschedule")}
            </DropdownMenuItem>
          )}
          {active && can(P.appointmentsCancel) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => change("no_show")}>
                <CircleSlash />
                {t("noShow")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setCancelOpen(true)}>
                <XCircle />
                {t("cancel")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {compose && (
        <MessageComposer
          open
          onOpenChange={(o) => !o && setCompose(null)}
          patientId={a.patient_id}
          appointmentId={a.id}
          channel={compose.channel}
          purpose={compose.purpose}
        />
      )}
      {exportOpen && (
        <ExportDialog open onOpenChange={setExportOpen} target={{ type: "appointment_summary", entityId: a.id, patientId: a.patient_id }} />
      )}

      {rescheduleOpen && (
        <AppointmentDialog
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          reschedule={{
            id: a.id,
            doctor_id: a.doctor_id,
            department_id: a.department_id,
            visit_type: a.visit_type,
            scheduled_at: a.scheduled_at,
            duration_minutes: a.duration_minutes,
            notes: a.notes,
          }}
        />
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
            <DialogDescription>{t("cancelBody", { patient: a.patient?.full_name ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`cancel-${a.id}`}>{t("cancelReason")}</Label>
            <Textarea id={`cancel-${a.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>{t("keep")}</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setCancelOpen(false)
                change("cancelled", reason.trim() || undefined)
              }}
            >
              {t("confirmCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {visitOpen && (
        <StartVisitDialog
          open={visitOpen}
          onOpenChange={setVisitOpen}
          patientId={a.patient_id}
          appointmentId={a.id}
          suggested={appointmentTypeToVisit(a.visit_type)}
        />
      )}
    </div>
  )
}
