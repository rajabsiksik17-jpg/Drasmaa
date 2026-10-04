"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  Baby,
  CalendarPlus,
  ChevronDown,
  Copy,
  DoorOpen,
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
  Play,
  Printer,
  Share2,
  Stethoscope,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InlineEdit } from "@/components/forms/inline-edit"
import { EncounterStatusBadge } from "@/components/encounters/encounter-status"
import { appointmentTypeToVisit } from "@/components/visits/start-visit-dialog"
import { useCan, useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { setAppointmentStatus } from "@/lib/actions/appointments"
import { openAppointmentInvoice } from "@/lib/actions/accounting"
import { createFertilityCase, createPregnancyCase, startOiCycle } from "@/lib/actions/clinical"
import { ageFromDob, formatDate } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { PatientContext } from "@/lib/data/patient"
import type { VisitType } from "@/types/db"

// Dialogs are only downloaded when opened: the header stays light on phones.
const StartVisitDialog = dynamic(() => import("@/components/visits/start-visit-dialog").then((m) => m.StartVisitDialog), { ssr: false })
const AppointmentDialog = dynamic(() => import("@/components/appointments/appointment-dialog").then((m) => m.AppointmentDialog), { ssr: false })
const UploadDialog = dynamic(() => import("@/components/documents/upload-dialog").then((m) => m.UploadDialog), { ssr: false })
const PatientShareDialog = dynamic(() => import("@/components/documents/patient-share-dialog").then((m) => m.PatientShareDialog), { ssr: false })
const MessageComposer = dynamic(() => import("@/components/messaging/message-composer").then((m) => m.MessageComposer), { ssr: false })
const WalkInDialog = dynamic(() => import("@/components/encounters/walk-in-dialog").then((m) => m.WalkInDialog), { ssr: false })

type Dialog = "visit" | "appointment" | "upload" | "share" | "message" | "walkIn" | null

/** Becomes true once the page scrolls past the header's full form (one observer, no per-scroll renders). */
function useScrolledPast(ref: React.RefObject<HTMLElement | null>) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(([entry]) => setPast(!entry.isIntersecting), { rootMargin: "-56px 0px 0px 0px" })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return past
}

/**
 * Sticky clinical context. Always visible: name, file number, drug-allergy
 * warning and today's status. Desktop shows age, phone and clinical
 * indicators in one compact row; phones get a slim identity bar with
 * expandable details and an action menu. Dialogs load on demand.
 */
export function PatientHeader({ ctx }: { ctx: PatientContext }) {
  const t = useTranslations("patient")
  const can = useCan()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { message } = useActionError()
  const [pending, start] = useSafeTransition()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [visitType, setVisitType] = useState<VisitType | null>(null)
  const [details, setDetails] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const compact = useScrolledPast(sentinel)

  const { patient, husband, allergy, todayAppointment, openEncounter } = ctx
  const age = ageFromDob(patient.dob)
  const allergyText = allergy?.allergy?.trim()
  const base = `/patients/${patient.id}`
  const invoice = openEncounter?.invoices[0]
  const balance = invoice ? Number(invoice.balance_patient) : 0

  // Command palette deep links (/patients/:id?action=...) open the matching
  // dialog; the parameter is removed when the dialog closes.
  const action = params.get("action")
  const messageAppointment = params.get("message")
  const urlVisit = action?.startsWith("new-visit-") ? (action.replace("new-visit-", "") as VisitType) : null
  const active: Dialog =
    dialog ??
    (urlVisit
      ? "visit"
      : action === "appointment"
        ? "appointment"
        : action === "upload"
          ? "upload"
          : action === "walk-in"
            ? "walkIn"
            : messageAppointment
              ? "message"
              : null)
  const clearParams = useCallback(() => {
    if (!action && !messageAppointment) return
    const next = new URLSearchParams(params)
    next.delete("action")
    next.delete("message")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }, [action, messageAppointment, params, pathname, router])
  const close = useCallback(() => {
    setDialog(null)
    clearParams()
  }, [clearParams])

  useEffect(() => {
    if (action !== "new-oi") return
    openOi()
    clearParams()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  const checkIn = () =>
    todayAppointment &&
    start(async () => {
      const res = await setAppointmentStatus({ id: todayAppointment.id, status: "checked_in", expectedVersion: todayAppointment.version })
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("checkedIn"))
      router.refresh()
    })

  const openBill = () =>
    start(async () => {
      if (invoice) return router.push(`/accounting/invoices/${invoice.id}`)
      if (!todayAppointment) return
      const res = await openAppointmentInvoice(todayAppointment.id)
      if (!res.ok) return void toast.error(message(res.error))
      router.push(`/accounting/invoices/${res.data.id}`)
    })

  function openOi() {
    if (ctx.activeCycle) return router.push(`${base}/cycles/${ctx.activeCycle.id}`)
    start(async () => {
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
    start(async () => {
      const res = await createFertilityCase(patient.id)
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("fertilityCreated", { number: res.data.case_number }))
      router.push(`${base}?tab=fertility`)
      router.refresh()
    })
  }

  const startPregnancy = () => {
    if (ctx.activePregnancy) return router.push(`${base}/pregnancies/${ctx.activePregnancy.id}`)
    start(async () => {
      const res = await createPregnancyCase({ patientId: patient.id })
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("pregnancyCreated", { number: res.data.case_number }))
      router.push(`${base}/pregnancies/${res.data.id}`)
    })
  }

  const openVisit = (type: VisitType | null) => {
    setVisitType(type)
    setDialog("visit")
  }

  const primary = (
    <PrimaryAction
      ctx={ctx}
      pending={pending}
      balance={balance}
      onCheckIn={checkIn}
      onWalkIn={() => setDialog("walkIn")}
      onBill={openBill}
      onStartVisit={() => openVisit(appointmentTypeToVisit(todayAppointment?.visit_type))}
    />
  )

  const menu = (
    <ActionMenu
      ctx={ctx}
      onVisit={() => openVisit(null)}
      onAppointment={() => setDialog("appointment")}
      onMessage={() => setDialog("message")}
      onShare={() => setDialog("share")}
      onUpload={() => setDialog("upload")}
      onOi={openOi}
      onFertility={startFertility}
      onPregnancy={startPregnancy}
      onBill={invoice || todayAppointment ? openBill : null}
    />
  )

  const allergyBanner = ctx.canSeeAllergy && allergyText && (
    <div role="alert" className="flex min-w-0 items-center gap-2 rounded-lg border border-allergy/40 bg-allergy-bg px-3 py-1.5 text-sm font-bold text-allergy">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="shrink-0 tracking-wide uppercase">{t("drugAllergy")}:</span>
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
    </div>
  )

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <header className="sticky top-14 z-20 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {/* Identity row (all sizes) */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span
            className={cn(
              "hidden shrink-0 place-items-center rounded-full bg-primary/12 font-semibold text-primary sm:grid",
              compact ? "size-8 text-xs" : "size-11 text-sm",
            )}
            aria-hidden
          >
            {initials(patient.full_name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className={cn("min-w-0 font-semibold tracking-tight max-sm:line-clamp-2 sm:truncate", compact ? "text-base" : "text-base sm:text-xl")}>
                <Link href={base} className="hover:text-primary">
                  {patient.full_name}
                </Link>
              </h1>
              <span className="hidden sm:contents">
                <CopyId code={patient.patient_code} />
              </span>
              {ctx.canSeeAllergy && allergyText && compact && (
                // Desktop, scrolled: the allergy stays visible next to the name.
                <AllergyPill text={allergyText} className="hidden max-w-[22rem] sm:inline-flex" />
              )}
            </div>
            {/* Phones: file number + drug allergy (always visible, readable) */}
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 sm:hidden">
              <CopyId code={patient.patient_code} />
              {ctx.canSeeAllergy && allergyText && <AllergyPill text={allergyText} wrap className="min-w-0 grow basis-40" />}
            </div>
            {/* Desktop: one compact line of key facts */}
            {!compact && (
              <div className="mt-0.5 hidden flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground sm:flex">
                <span>
                  {age != null ? t("age", { age }) : t("noDob")}
                  {patient.dob ? ` · ${formatDate(patient.dob)}` : ""}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3.5" />
                  <span dir="ltr">
                    <InlineEdit table="patients" recordKey={patient.id} field="phone" version={patient.version} value={patient.phone} type="tel" label={t("phone")} canEdit={can(P.patientsEdit)} />
                  </span>
                </span>
                {husband?.full_name && <span className="truncate">{t("husband", { name: husband.full_name })}</span>}
              </div>
            )}
          </div>
          <div className="no-print flex shrink-0 items-center gap-1.5">
            {primary}
            <DesktopActions ctx={ctx} pending={pending} onVisit={() => openVisit(null)} onAppointment={() => setDialog("appointment")} onMessage={() => setDialog("message")} onShare={() => setDialog("share")} onOi={openOi} />
            {menu}
          </div>
        </div>

        {/* Indicators: status, payment type, active cases (scrolls sideways on phones) */}
        <Indicators ctx={ctx} compact={compact} onToggleDetails={() => setDetails((d) => !d)} detailsOpen={details} />

        {/* Phones: details on demand */}
        {details && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm sm:hidden">
            <span className="text-muted-foreground">{t("ageLabel")}</span>
            <span>
              {age != null ? age : t("noDob")}
              {patient.dob ? ` · ${formatDate(patient.dob)}` : ""}
            </span>
            <span className="text-muted-foreground">{t("phone")}</span>
            <span dir="ltr" className="text-start">
              <InlineEdit table="patients" recordKey={patient.id} field="phone" version={patient.version} value={patient.phone} type="tel" label={t("phone")} canEdit={can(P.patientsEdit)} />
            </span>
            {husband?.full_name && (
              <>
                <span className="text-muted-foreground">{t("husbandLabel")}</span>
                <span className="truncate">{husband.full_name}</span>
              </>
            )}
          </div>
        )}

        {/* Drug allergy: full banner unless the page is scrolled (then the red pill / badge stays visible) */}
        {!compact && allergyBanner && <div className="mt-2 hidden sm:block">{allergyBanner}</div>}
        {details && allergyBanner && <div className="mt-2 sm:hidden">{allergyBanner}</div>}
        {!compact && ctx.canSeeAllergy && !allergyText && allergy && (
          <div className="mt-1 hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span>{t("noKnownAllergy")}</span>
            {can(P.medicalEdit) && (
              <InlineEdit table="patient_allergies" recordKey={patient.id} field="allergy" version={allergy.version} value={null} label={t("drugAllergy")} display={<span className="sr-only">{t("drugAllergy")}</span>} />
            )}
          </div>
        )}
      </header>

      {active === "visit" && (
        <StartVisitDialog
          open
          onOpenChange={(o) => !o && close()}
          patientId={patient.id}
          appointmentId={todayAppointment?.id ?? null}
          encounterId={openEncounter?.id ?? null}
          suggested={urlVisit ?? visitType}
        />
      )}
      {active === "appointment" && (
        <AppointmentDialog open onOpenChange={(o) => !o && close()} patient={{ id: patient.id, full_name: patient.full_name, patient_code: patient.patient_code }} />
      )}
      {active === "walkIn" && (
        <WalkInDialog open onOpenChange={(o) => !o && close()} patient={{ id: patient.id, full_name: patient.full_name, patient_code: patient.patient_code }} />
      )}
      {active === "share" && <PatientShareDialog patientId={patient.id} open onOpenChange={(o) => !o && close()} />}
      {active === "message" && (
        <MessageComposer
          open
          onOpenChange={(o) => !o && close()}
          patientId={patient.id}
          appointmentId={messageAppointment && /^[0-9a-f-]{36}$/.test(messageAppointment) ? messageAppointment : null}
          channel="whatsapp"
        />
      )}
      {active === "upload" && <UploadDialog open onOpenChange={(o) => !o && close()} links={{ patientId: patient.id }} />}
    </>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
}

/** Compact drug-allergy warning (safety: never hidden, text truncated only by the space available). */
function AllergyPill({ text, className, wrap }: { text: string; className?: string; wrap?: boolean }) {
  const t = useTranslations("patient")
  return (
    <span
      role="alert"
      title={text}
      className={cn("inline-flex items-start gap-1 rounded-xl border border-allergy/40 bg-allergy-bg px-2 py-0.5 text-[11px] leading-snug font-bold text-allergy", className)}
    >
      <AlertTriangle className="mt-px size-3 shrink-0" />
      {/* Phones: the full list wraps (never cut); desktop compact bar: one line. */}
      <span className={wrap ? "min-w-0 break-words" : "truncate"}>
        {t("allergyShort")}: <bdi>{text}</bdi>
      </span>
    </span>
  )
}

const CopyId = memo(function CopyId({ code }: { code: string }) {
  const t = useTranslations("patient")
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code)
        toast.success(t("idCopied"))
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
      aria-label={t("copyId")}
    >
      {code}
      <Copy className="size-3" />
    </button>
  )
})

/** The one most useful next step for this patient today. */
function PrimaryAction({
  ctx,
  pending,
  balance,
  onCheckIn,
  onWalkIn,
  onBill,
  onStartVisit,
}: {
  ctx: PatientContext
  pending: boolean
  balance: number
  onCheckIn: () => void
  onWalkIn: () => void
  onBill: () => void
  onStartVisit: () => void
}) {
  const t = useTranslations("patient.actions")
  const can = useCan()
  const e = ctx.openEncounter
  if (e) {
    const open = e.visits.find((v) => v.status === "draft" || v.status === "in_progress")
    if ((e.status === "waiting_payment" || e.status === "awaiting_checkout") && can(P.accountingView) && e.invoices[0]) {
      return (
        <Button size="sm" onClick={onBill} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Wallet />}
          <span className="max-sm:sr-only">{balance > 0.0005 ? t("collect") : t("checkout")}</span>
        </Button>
      )
    }
    if ((e.status === "waiting_doctor" || e.status === "with_doctor") && can(P.visitsCreate)) {
      return open ? (
        <Button size="sm" asChild>
          <Link href={`/patients/${ctx.patient.id}/visits/${open.id}`}>
            <Play className="rtl:-scale-x-100" />
            <span className="max-sm:sr-only">{t("continueVisit")}</span>
          </Link>
        </Button>
      ) : (
        <Button size="sm" onClick={onStartVisit}>
          <Stethoscope />
          <span className="max-sm:sr-only">{t("newVisit")}</span>
        </Button>
      )
    }
    return null
  }
  if (ctx.todayAppointment?.status === "scheduled" && can(P.appointmentsCheckin)) {
    return (
      <Button size="sm" variant="secondary" onClick={onCheckIn} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <LogIn className="rtl:-scale-x-100" />}
        <span className="max-sm:sr-only">{t("checkIn")}</span>
      </Button>
    )
  }
  if (can(P.encountersCreate) && ctx.patient.status !== "archived") {
    return (
      <Button size="sm" onClick={onWalkIn}>
        <DoorOpen />
        <span className="max-sm:sr-only">{t("visitNow")}</span>
      </Button>
    )
  }
  return null
}

/** Secondary buttons, desktop only (phones use the menu). */
function DesktopActions({
  ctx,
  pending,
  onVisit,
  onAppointment,
  onMessage,
  onShare,
  onOi,
}: {
  ctx: PatientContext
  pending: boolean
  onVisit: () => void
  onAppointment: () => void
  onMessage: () => void
  onShare: () => void
  onOi: () => void
}) {
  const t = useTranslations("patient.actions")
  const can = useCan()
  return (
    <div className="hidden items-center gap-1.5 lg:flex">
      {can(P.visitsCreate) && !ctx.openEncounter && (
        <Button size="sm" variant="outline" onClick={onVisit}>
          <Stethoscope />
          {t("newVisit")}
        </Button>
      )}
      {can(P.appointmentsCreate) && (
        <Button size="sm" variant="outline" onClick={onAppointment}>
          <CalendarPlus />
          {t("appointment")}
        </Button>
      )}
      {can(P.messagesSend) && (
        <Button size="icon-sm" variant="outline" onClick={onMessage} aria-label={t("message")}>
          <MessageSquareText />
        </Button>
      )}
      {can(P.documentsGenerate) && (
        <Button size="icon-sm" variant="outline" onClick={onShare} aria-label={t("share")}>
          <Share2 />
        </Button>
      )}
      {can(P.oiEdit) && (
        <Button size="icon-sm" variant="outline" onClick={onOi} disabled={pending} aria-label={ctx.activeCycle ? t("openOi") : t("startOi")}>
          <HeartPulse />
        </Button>
      )}
    </div>
  )
}

function ActionMenu({
  ctx,
  onVisit,
  onAppointment,
  onMessage,
  onShare,
  onUpload,
  onOi,
  onFertility,
  onPregnancy,
  onBill,
}: {
  ctx: PatientContext
  onVisit: () => void
  onAppointment: () => void
  onMessage: () => void
  onShare: () => void
  onUpload: () => void
  onOi: () => void
  onFertility: () => void
  onPregnancy: () => void
  onBill: (() => void) | null
}) {
  const t = useTranslations("patient.actions")
  const can = useCan()
  const base = `/patients/${ctx.patient.id}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="outline" aria-label={t("more")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* Phones / tablets: everything that is a button on desktop */}
        <div className="lg:hidden">
          {can(P.visitsCreate) && (
            <DropdownMenuItem onSelect={onVisit}>
              <Stethoscope />
              {t("newVisit")}
            </DropdownMenuItem>
          )}
          {can(P.appointmentsCreate) && (
            <DropdownMenuItem onSelect={onAppointment}>
              <CalendarPlus />
              {t("appointment")}
            </DropdownMenuItem>
          )}
          {can(P.messagesSend) && (
            <DropdownMenuItem onSelect={onMessage}>
              <MessageSquareText />
              {t("message")}
            </DropdownMenuItem>
          )}
          {can(P.documentsGenerate) && (
            <DropdownMenuItem onSelect={onShare}>
              <Share2 />
              {t("share")}
            </DropdownMenuItem>
          )}
          {can(P.oiEdit) && (
            <DropdownMenuItem onSelect={onOi}>
              <HeartPulse />
              {ctx.activeCycle ? t("openOi") : t("startOi")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
        </div>
        {can(P.documentsUpload) && (
          <DropdownMenuItem onSelect={onUpload}>
            <FileUp />
            {t("upload")}
          </DropdownMenuItem>
        )}
        {can(P.fertilityEdit) && (
          <DropdownMenuItem onSelect={onFertility}>
            <FlaskConical />
            {t("fertility")}
          </DropdownMenuItem>
        )}
        {can(P.pregnancyEdit) && (
          <DropdownMenuItem onSelect={onPregnancy}>
            <Baby />
            {t("pregnancy")}
          </DropdownMenuItem>
        )}
        {can(P.reportsCreate) && (
          <DropdownMenuItem asChild>
            <Link href={`/reports/new?patient=${ctx.patient.id}`}>
              <FileSignature />
              {t("addReport")}
            </Link>
          </DropdownMenuItem>
        )}
        {can(P.accountingCreate) && onBill && (
          <DropdownMenuItem onSelect={onBill}>
            <Wallet />
            {t("checkout")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`${base}?tab=timeline`}>
            <History />
            {t("timeline")}
          </Link>
        </DropdownMenuItem>
        {can(P.medicalView) && (
          <DropdownMenuItem asChild>
            <a href={`/print/history/${ctx.patient.id}`} target="_blank" rel="noopener">
              <Printer />
              {t("print")}
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Small status chips; horizontally scrollable on phones instead of wrapping into many rows. */
const Indicators = memo(function Indicators({
  ctx,
  compact,
  detailsOpen,
  onToggleDetails,
}: {
  ctx: PatientContext
  compact: boolean
  detailsOpen: boolean
  onToggleDetails: () => void
}) {
  const t = useTranslations("patient")
  const refs = useRefs()
  const { patient, openEncounter, todayAppointment } = ctx
  const chip = "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap"
  return (
    <div className={cn("-mx-4 mt-1.5 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0", compact && "max-sm:hidden sm:mt-1")} style={{ scrollbarWidth: "none" }}>
      <button type="button" onClick={onToggleDetails} className={cn(chip, "bg-muted/50 sm:hidden")} aria-expanded={detailsOpen}>
        {t("details")}
        <ChevronDown className={cn("size-3 transition-transform", detailsOpen && "rotate-180")} />
      </button>
      {openEncounter ? (
        <EncounterStatusBadge status={openEncounter.status} prepay={openEncounter.prepay} />
      ) : (
        todayAppointment && <span className={cn(chip, "bg-muted/50")}>{t("appointmentToday")}</span>
      )}
      {patient.status === "archived" && <span className={cn(chip, "bg-muted text-muted-foreground")}>{t("archived")}</span>}
      <span className={cn(chip, "bg-background")}>
        {patient.payment_method === "insurance" ? refs.insuranceName(patient.insurance_company_id) || t("insurance") : t("cash")}
      </span>
      {ctx.activePregnancy && (
        <Link href={`/patients/${patient.id}/pregnancies/${ctx.activePregnancy.id}`} className={cn(chip, "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300")}>
          <Baby className="size-3" />
          {ctx.pregnancyGa ? t("gaShort", { weeks: ctx.pregnancyGa.weeks, days: ctx.pregnancyGa.days }) : t("pregnant")}
        </Link>
      )}
      {ctx.activeFertilityCase && (
        <Link href={`/patients/${patient.id}?tab=fertility`} className={cn(chip, "border-primary/30 bg-primary/10 text-primary")}>
          <FlaskConical className="size-3" />
          {t("fertilityCase")}
        </Link>
      )}
      {ctx.activeCycle && (
        <Link href={`/patients/${patient.id}/cycles/${ctx.activeCycle.id}`} className={cn(chip, "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300")}>
          <HeartPulse className="size-3" />
          {t("oiCycle", { number: ctx.activeCycle.cycle_number })}
        </Link>
      )}
    </div>
  )
})
