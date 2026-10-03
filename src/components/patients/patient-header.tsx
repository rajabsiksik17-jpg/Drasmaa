"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion, useScroll, useMotionValueEvent } from "motion/react"
import {
  AlertTriangle,
  Baby,
  CalendarPlus,
  Copy,
  FileSignature,
  FileUp,
  FlaskConical,
  HeartPulse,
  History,
  Loader2,
  LogIn,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Printer,
  Share2,
  Stethoscope,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { InlineEdit } from "@/components/forms/inline-edit"
import { AppointmentDialog } from "@/components/appointments/appointment-dialog"
import { StartVisitDialog, appointmentTypeToVisit } from "@/components/visits/start-visit-dialog"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { PatientShareDialog } from "@/components/documents/patient-share-dialog"
import { MessageComposer } from "@/components/messaging/message-composer"
import { useCan, useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { setAppointmentStatus } from "@/lib/actions/appointments"
import { openAppointmentInvoice } from "@/lib/actions/accounting"
import { createFertilityCase, createPregnancyCase, startOiCycle } from "@/lib/actions/clinical"
import { ageFromDob, formatDate } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { PatientContext } from "@/lib/data/patient"
import type { VisitType } from "@/types/db"

/**
 * Sticky clinical context: identity + drug-allergy warning are always
 * visible while working anywhere inside the patient's file.
 */
export function PatientHeader({ ctx }: { ctx: PatientContext }) {
  const t = useTranslations("patient")
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { message } = useActionError()
  const [pending, startTransition] = useTransition()
  const [compact, setCompact] = useState(false)
  const [visitOpen, setVisitOpen] = useState<VisitType | true | false>(false)
  const [apptOpen, setApptOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, "change", (y) => setCompact(y > 140))

  const { patient, husband, allergy, todayAppointment } = ctx
  const age = ageFromDob(patient.dob)
  const allergyText = allergy?.allergy?.trim()
  const picked = { id: patient.id, full_name: patient.full_name, patient_code: patient.patient_code }
  const base = `/patients/${patient.id}`

  // Command palette deep links (/patients/:id?action=...) open the matching
  // dialog directly; the parameter is removed when the dialog closes.
  const action = params.get("action")
  const clearAction = () => {
    if (!action) return
    const next = new URLSearchParams(params)
    next.delete("action")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }
  const urlVisit = action?.startsWith("new-visit-") ? (action.replace("new-visit-", "") as VisitType) : null
  const visitDialog: VisitType | true | false = visitOpen !== false ? visitOpen : (urlVisit ?? false)
  const apptDialog = apptOpen || action === "appointment"
  const uploadDialog = uploadOpen || action === "upload"
  // Deep link from a "WhatsApp reminder ready" notification: ?message=<appointmentId>
  const messageAppointment = params.get("message")
  const messageDialog = messageOpen || !!messageAppointment
  useEffect(() => {
    if (action !== "new-oi") return
    openOi()
    clearAction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  const checkIn = () =>
    todayAppointment &&
    startTransition(async () => {
      const res = await setAppointmentStatus({ id: todayAppointment.id, status: "checked_in", expectedVersion: todayAppointment.version })
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("checkedIn"))
      router.refresh()
    })

  const checkout = () =>
    todayAppointment &&
    startTransition(async () => {
      const res = await openAppointmentInvoice(todayAppointment.id)
      if (!res.ok) return void toast.error(message(res.error))
      router.push(`/accounting/invoices/${res.data.id}`)
    })

  function openOi() {
    if (ctx.activeCycle) {
      router.push(`${base}/cycles/${ctx.activeCycle.id}`)
      return
    }
    startTransition(async () => {
      let caseId = ctx.activeFertilityCase?.id
      if (!caseId) {
        const created = await createFertilityCase(patient.id)
        if (!created.ok) return void toast.error(message(created.error))
        caseId = created.data.id
      }
      const res = await startOiCycle({ fertilityCaseId: caseId })
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("cycleStarted", { number: res.data.cycle_number }))
      router.push(`${base}/cycles/${res.data.id}`)
    })
  }

  const startFertility = () => {
    if (ctx.activeFertilityCase) return router.push(`${base}?tab=fertility`)
    startTransition(async () => {
      const res = await createFertilityCase(patient.id)
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("fertilityCreated", { number: res.data.case_number }))
      router.push(`${base}?tab=fertility`)
      router.refresh()
    })
  }

  const startPregnancy = () => {
    if (ctx.activePregnancy) return router.push(`${base}/pregnancies/${ctx.activePregnancy.id}`)
    startTransition(async () => {
      const res = await createPregnancyCase({ patientId: patient.id })
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("pregnancyCreated", { number: res.data.case_number }))
      router.push(`${base}/pregnancies/${res.data.id}`)
    })
  }

  return (
    <>
      <motion.header
        layout
        className={cn(
          "sticky top-14 z-20 -mx-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
          compact ? "py-2" : "py-4",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <motion.span
              layout
              className={cn(
                "grid shrink-0 place-items-center rounded-full bg-primary/12 font-semibold text-primary",
                compact ? "size-8 text-xs" : "size-12 text-base",
              )}
            >
              {patient.full_name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")}
            </motion.span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <h1 className={cn("min-w-0 font-semibold tracking-tight", compact ? "text-base" : "text-xl")}>
                  <Link href={base} className="hover:text-primary">
                    {patient.full_name}
                  </Link>
                </h1>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(patient.patient_code)
                    toast.success(t("idCopied"))
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                  aria-label={t("copyId")}
                >
                  {patient.patient_code}
                  <Copy className="size-3" />
                </button>
                {patient.status === "archived" && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("archived")}</span>
                )}
              </div>
              {!compact && (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    {age != null ? t("age", { age }) : t("noDob")}
                    {patient.dob ? ` · ${formatDate(patient.dob)}` : ""}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3.5" />
                    <span dir="ltr">
                      <InlineEdit
                        table="patients"
                        recordKey={patient.id}
                        field="phone"
                        version={patient.version}
                        value={patient.phone}
                        type="tel"
                        label={t("phone")}
                        canEdit={can(P.patientsEdit)}
                      />
                    </span>
                  </span>
                  {husband?.full_name && <span>{t("husband", { name: husband.full_name })}</span>}
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {patient.payment_method === "insurance" ? refs.insuranceName(patient.insurance_company_id) || t("insurance") : t("cash")}
                  </span>
                </div>
              )}
            </div>
          </div>

          <QuickActions
            compact={compact}
            pending={pending}
            todayStatus={todayAppointment?.status ?? null}
            onCheckIn={checkIn}
            onVisit={() => setVisitOpen(true)}
            onAppointment={() => setApptOpen(true)}
            onUpload={() => setUploadOpen(true)}
            onShare={() => setShareOpen(true)}
            onMessage={() => setMessageOpen(true)}
            onFertility={startFertility}
            onPregnancy={startPregnancy}
            onOi={openOi}
            hasActiveCycle={!!ctx.activeCycle}
            printHref={`/print/history/${patient.id}`}
            timelineHref={`${base}?tab=timeline`}
            patientId={patient.id}
            todayAppointmentId={todayAppointment?.id ?? null}
            onCheckout={checkout}
          />
        </div>

        {ctx.canSeeAllergy && (
          <AnimatePresence initial={false}>
            {allergyText ? (
              <motion.div
                key="allergy"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                role="alert"
                className={cn(
                  "mt-2 flex items-center gap-2 rounded-lg border border-allergy/40 bg-allergy-bg px-3 font-bold text-allergy",
                  compact ? "py-1 text-xs" : "py-1.5 text-sm",
                )}
              >
                <AlertTriangle className="size-4 shrink-0" />
                <span className="tracking-wide uppercase">{t("drugAllergy")}:</span>
                <InlineEdit
                  table="patient_allergies"
                  recordKey={patient.id}
                  field="allergy"
                  version={allergy!.version}
                  value={allergy!.allergy}
                  label={t("drugAllergy")}
                  canEdit={can(P.medicalEdit)}
                  tone="danger"
                  className="min-w-0"
                />
              </motion.div>
            ) : (
              !compact &&
              allergy && (
                <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("noKnownAllergy")}</span>
                  {can(P.medicalEdit) && (
                    <InlineEdit
                      table="patient_allergies"
                      recordKey={patient.id}
                      field="allergy"
                      version={allergy.version}
                      value={null}
                      label={t("drugAllergy")}
                      display={<span className="sr-only">{t("drugAllergy")}</span>}
                    />
                  )}
                </motion.div>
              )
            )}
          </AnimatePresence>
        )}
      </motion.header>

      {visitDialog !== false && (
        <StartVisitDialog
          open
          onOpenChange={(o) => {
            if (o) return
            setVisitOpen(false)
            clearAction()
          }}
          patientId={patient.id}
          appointmentId={todayAppointment?.id ?? null}
          suggested={visitDialog === true ? appointmentTypeToVisit(todayAppointment?.visit_type) : visitDialog}
        />
      )}
      {apptDialog && (
        <AppointmentDialog
          open
          onOpenChange={(o) => {
            setApptOpen(o)
            if (!o) clearAction()
          }}
          patient={picked}
        />
      )}
      {shareOpen && <PatientShareDialog patientId={patient.id} open onOpenChange={setShareOpen} />}
      {messageDialog && (
        <MessageComposer
          open
          onOpenChange={(o) => {
            if (o) return
            setMessageOpen(false)
            if (messageAppointment) {
              const next = new URLSearchParams(params)
              next.delete("message")
              router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
            }
          }}
          patientId={patient.id}
          appointmentId={messageAppointment && /^[0-9a-f-]{36}$/.test(messageAppointment) ? messageAppointment : null}
          channel="whatsapp"
        />
      )}
      <UploadDialog
        open={uploadDialog}
        onOpenChange={(o) => {
          setUploadOpen(o)
          if (!o) clearAction()
        }}
        links={{ patientId: patient.id }}
      />
    </>
  )
}

function QuickActions(props: {
  compact: boolean
  pending: boolean
  todayStatus: string | null
  onCheckIn: () => void
  onVisit: () => void
  onAppointment: () => void
  onUpload: () => void
  onShare: () => void
  onMessage: () => void
  onFertility: () => void
  onPregnancy: () => void
  onOi: () => void
  hasActiveCycle: boolean
  printHref: string
  timelineHref: string
  patientId: string
  todayAppointmentId: string | null
  onCheckout: () => void
}) {
  const t = useTranslations("patient.actions")
  const can = useCan()
  const size = props.compact ? "sm" : "default"
  return (
    <div className="no-print flex flex-wrap items-center gap-1.5">
      {props.todayStatus === "scheduled" && can(P.appointmentsCheckin) && (
        <Button size={size} variant="secondary" onClick={props.onCheckIn} disabled={props.pending}>
          {props.pending ? <Loader2 className="animate-spin" /> : <LogIn className="rtl:-scale-x-100" />}
          {t("checkIn")}
        </Button>
      )}
      {can(P.visitsCreate) && (
        <Button size={size} onClick={props.onVisit}>
          <Stethoscope />
          {t("newVisit")}
        </Button>
      )}
      {can(P.appointmentsCreate) && (
        <Button size={size} variant="outline" onClick={props.onAppointment}>
          <CalendarPlus />
          <span className="hidden sm:inline">{t("appointment")}</span>
        </Button>
      )}
      {can(P.messagesSend) && (
        <Button size={size} variant="outline" onClick={props.onMessage}>
          <MessageSquareText />
          <span className="hidden md:inline">{t("message")}</span>
        </Button>
      )}
      {can(P.documentsGenerate) && (
        <Button size={size} variant="outline" onClick={props.onShare}>
          <Share2 />
          <span className="hidden md:inline">{t("share")}</span>
        </Button>
      )}
      {can(P.oiEdit) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size={size} variant="outline" onClick={props.onOi} disabled={props.pending}>
              <HeartPulse />
              <span className="hidden lg:inline">{props.hasActiveCycle ? t("openOi") : t("startOi")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{props.hasActiveCycle ? t("openOi") : t("startOi")}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={props.compact ? "icon-sm" : "icon"} variant="outline" aria-label={t("more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {can(P.documentsUpload) && (
            <DropdownMenuItem onSelect={props.onUpload}>
              <FileUp />
              {t("upload")}
            </DropdownMenuItem>
          )}
          {can(P.fertilityEdit) && (
            <DropdownMenuItem onSelect={props.onFertility}>
              <FlaskConical />
              {t("fertility")}
            </DropdownMenuItem>
          )}
          {can(P.pregnancyEdit) && (
            <DropdownMenuItem onSelect={props.onPregnancy}>
              <Baby />
              {t("pregnancy")}
            </DropdownMenuItem>
          )}
          {can(P.reportsCreate) && (
            <DropdownMenuItem asChild>
              <Link href={`/reports/new?patient=${props.patientId}`}>
                <FileSignature />
                {t("addReport")}
              </Link>
            </DropdownMenuItem>
          )}
          {can(P.accountingCreate) && props.todayAppointmentId && (
            <DropdownMenuItem onSelect={props.onCheckout}>
              <Wallet />
              {t("checkout")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={props.timelineHref}>
              <History />
              {t("timeline")}
            </Link>
          </DropdownMenuItem>
          {can(P.medicalView) && (
            <DropdownMenuItem asChild>
              <a href={props.printHref} target="_blank" rel="noopener">
                <Printer />
                {t("print")}
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
