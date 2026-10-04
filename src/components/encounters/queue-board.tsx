"use client"

import { memo, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { BellRing, Ban, CheckCheck, DoorOpen, Play, Plus, Receipt, Stethoscope, UserRound, Users, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useCan, useRefs, useSession } from "@/components/app-context"
import { EncounterStatusBadge } from "@/components/encounters/encounter-status"
import { WalkInDialog } from "@/components/encounters/walk-in-dialog"
import { StartVisitDialog } from "@/components/visits/start-visit-dialog"
import { ReasonDialog } from "@/components/forms/correction-context"
import { Money } from "@/components/accounting/money"
import { useNow } from "@/hooks/use-hydration"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { markPatientSent, requestPatient, setEncounterStatus } from "@/lib/actions/encounters"
import { ageFromDob, formatTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { QueueEncounter } from "@/lib/data/encounters"
import type { EncounterStatus } from "@/types/db"

type Lane = "payment" | "doctor" | "with_doctor" | "checkout" | "done"
const LANE_OF: Record<EncounterStatus, Lane> = {
  waiting_payment: "payment",
  waiting_doctor: "doctor",
  called: "doctor",
  with_doctor: "with_doctor",
  awaiting_checkout: "checkout",
  checked_out: "done",
  cancelled: "done",
}

/**
 * Today's real clinic visits as a live queue. Lanes follow the payment
 * workflow (payment before or after the doctor); phones get one lane at a
 * time with counts, larger screens see all lanes side by side.
 */
export function QueueBoard({ rows, prepay }: { rows: QueueEncounter[]; prepay: boolean }) {
  const t = useTranslations("encounters")
  const can = useCan()
  const session = useSession()
  const [mine, setMine] = useState(!!session.doctorId)
  const [walkIn, setWalkIn] = useState(false)
  const lanes: Lane[] = prepay ? ["payment", "doctor", "with_doctor", "checkout", "done"] : ["doctor", "with_doctor", "checkout", "done"]
  const [lane, setLane] = useState<Lane>(lanes[0])
  const visible = useMemo(
    () => (mine && session.doctorId ? rows.filter((r) => !r.doctor_id || r.doctor_id === session.doctorId) : rows),
    [rows, mine, session.doctorId],
  )
  const byLane = useMemo(() => {
    const m = new Map<Lane, QueueEncounter[]>(lanes.map((l) => [l, []]))
    for (const r of visible) m.get(LANE_OF[r.status])?.push(r)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, prepay])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {can(P.encountersCreate) && (
          <Button onClick={() => setWalkIn(true)}>
            <Plus />
            {t("createNow")}
          </Button>
        )}
        {session.doctorId && (
          <div className="flex rounded-lg border bg-muted/40 p-0.5 text-xs">
            {[true, false].map((m) => (
              <button key={String(m)} type="button" onClick={() => setMine(m)} className={cn("rounded-md px-2.5 py-1.5 font-medium", mine === m ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {m ? t("myPatients") : t("allPatients")}
              </button>
            ))}
          </div>
        )}
        <span className="ms-auto text-xs text-muted-foreground">{t(prepay ? "prepayMode" : "postpayMode")}</span>
      </div>

      {/* Phones: one lane at a time. */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden" role="tablist">
        {lanes.map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={lane === l}
            onClick={() => setLane(l)}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", lane === l ? "border-primary bg-primary text-primary-foreground" : "bg-card")}
          >
            {t(`lanes.${l}`)}
            <span className={cn("rounded-full px-1.5 text-xs tabular-nums", lane === l ? "bg-primary-foreground/20" : "bg-muted")}>{byLane.get(l)?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="lg:hidden">
        <LaneList rows={byLane.get(lane) ?? []} empty={t(`empty.${lane}`)} />
      </div>

      <div className={cn("hidden gap-3 lg:grid", prepay ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {lanes.map((l) => (
          <section key={l} className="min-w-0 rounded-xl border bg-muted/20 p-2">
            <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
              {t(`lanes.${l}`)}
              <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{byLane.get(l)?.length ?? 0}</span>
            </h2>
            <LaneList rows={byLane.get(l) ?? []} empty={t(`empty.${l}`)} compact />
          </section>
        ))}
      </div>

      {walkIn && <WalkInDialog open onOpenChange={setWalkIn} />}
    </div>
  )
}

function LaneList({ rows, empty, compact }: { rows: QueueEncounter[]; empty: string; compact?: boolean }) {
  if (rows.length === 0) return <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <QueueCard key={r.id} row={r} index={i} compact={compact} />
      ))}
    </ul>
  )
}

/** Clinic-visit cards in a responsive grid (filtered views of the Appointments page). */
export function EncounterCards({ rows, empty }: { rows: QueueEncounter[]; empty: string }) {
  if (rows.length === 0) return <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r, i) => (
        <QueueCard key={r.id} row={r} index={i} />
      ))}
    </ul>
  )
}

export const QueueCard = memo(function QueueCard({ row, index, compact }: { row: QueueEncounter; index: number; compact?: boolean }) {
  const t = useTranslations("encounters")
  const locale = useLocale()
  const refs = useRefs()
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [startOpen, setStartOpen] = useState(false)
  const [ask, setAsk] = useState<null | "waiting_doctor" | "cancelled" | "checked_out">(null)
  const now = useNow(60_000)
  const invoice = row.invoices[0]
  const openVisit = row.visits.find((v) => v.status === "draft" || v.status === "in_progress")
  const balance = invoice ? Number(invoice.balance_patient) : 0
  const waited = now != null ? Math.max(0, Math.round((now - new Date(row.arrived_at).getTime()) / 60_000)) : null
  const age = ageFromDob(row.patient?.dob)
  const session = useSession()
  const mineToCall = can(P.visitsCreate) && (!row.doctor_id || row.doctor_id === session.doctorId || can(P.settingsManage))
  const call = () =>
    start(async () => {
      const res = await requestPatient(row.id)
      if (!res.ok) return showError(res.error)
      toast.success(t("requested"))
      router.refresh()
    })
  const sent = () =>
    start(async () => {
      const res = await markPatientSent(row.id)
      if (!res.ok) return showError(res.error)
      toast.success(t("markedSent"))
      router.refresh()
    })

  const move = (status: "waiting_doctor" | "with_doctor" | "awaiting_checkout" | "checked_out" | "cancelled", reason?: string) =>
    start(async () => {
      const res = await setEncounterStatus({ id: row.id, status, reason: reason ?? null })
      if (!res.ok) return showError(res.error)
      toast.success(t(`moved.${status}`))
      router.refresh()
    })
  const needsReason = (status: "waiting_doctor" | "checked_out") => balance > 0.0005 && (status === "checked_out" || row.prepay)

  return (
    <li className={cn("rounded-lg border bg-card p-3 shadow-xs", row.status === "cancelled" && "opacity-60")}>
      <div className="flex items-start gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/patients/${row.patient_id}`} className="block truncate font-medium hover:text-primary">
            {row.patient?.full_name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.patient?.patient_code}
            {age != null ? ` · ${t("age", { age })}` : ""} · {t("arrivedAt", { time: formatTime(row.arrived_at, locale) })}
            {row.appointment ? ` · ${t("bookedAt", { time: formatTime(row.appointment.scheduled_at, locale) })}` : ""}
            {waited != null && row.status !== "checked_out" && row.status !== "cancelled" ? ` · ${t("waited", { minutes: waited })}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <EncounterStatusBadge status={row.status} prepay={row.prepay} />
        {row.doctor_id && <span className="rounded-full bg-muted px-2 py-0.5">{refs.doctorName(row.doctor_id)}</span>}
        {row.source === "walk_in" && <span className="rounded-full bg-muted px-2 py-0.5">{t("walkIn")}</span>}
        {invoice && (can(P.accountingView) || can(P.billingCharge)) && (
          <span className={cn("rounded-full px-2 py-0.5", balance > 0.0005 ? "bg-destructive/10 text-destructive" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300")}>
            {balance > 0.0005 ? (
              <>
                {t("due")} <Money value={balance} currency={refs.settings.currency} />
              </>
            ) : (
              t("settled")
            )}
          </span>
        )}
      </div>
      {row.reason && !compact && <p className="mt-1.5 text-sm text-muted-foreground">{row.reason}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(row.status === "waiting_payment" || row.status === "awaiting_checkout") && invoice && can(P.accountingView) && (
          <Button size="sm" variant={balance > 0.0005 ? "default" : "outline"} asChild>
            <Link href={`/accounting/invoices/${invoice.id}`}>
              {balance > 0.0005 ? <Wallet /> : <Receipt />}
              {balance > 0.0005 ? t("collect") : t("bill")}
            </Link>
          </Button>
        )}
        {row.status === "waiting_payment" && can(P.accountingCreate, P.encountersCreate) && (
          <Button size="sm" variant="outline" onClick={() => (needsReason("waiting_doctor") ? setAsk("waiting_doctor") : move("waiting_doctor"))} disabled={pending}>
            <Stethoscope />
            {t("sendToDoctor")}
          </Button>
        )}
        {(row.status === "waiting_doctor" || row.status === "waiting_payment" || row.status === "called") && can(P.visitsCreate) && (
          <Button size="sm" onClick={() => setStartOpen(true)}>
            <Play className="rtl:-scale-x-100" />
            {t("startVisit")}
          </Button>
        )}
        {row.status === "waiting_doctor" && mineToCall && (
          <Button size="sm" variant="secondary" onClick={call} disabled={pending}>
            <BellRing />
            {t("callPatient")}
          </Button>
        )}
        {row.status === "called" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
            <BellRing className="size-3 motion-safe:animate-pulse" />
            {row.patient_sent_at ? t("patientSent") : t("doctorRequested")}
          </span>
        )}
        {row.status === "called" && !row.patient_sent_at && can(P.encountersCreate, P.appointmentsCheckin) && !can(P.visitsCreate) && (
          <Button size="sm" onClick={sent} disabled={pending}>
            <CheckCheck />
            {t("markSent")}
          </Button>
        )}
        {row.status === "called" && row.patient_sent_at && can(P.encountersCreate, P.appointmentsCheckin) && !can(P.visitsCreate) && (
          <Button size="sm" variant="secondary" onClick={() => move("with_doctor")} disabled={pending}>
            <DoorOpen />
            {t("patientEntered")}
          </Button>
        )}
        {row.status === "with_doctor" && openVisit && can(P.visitsView) && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/patients/${row.patient_id}/visits/${openVisit.id}`}>
              <UserRound />
              {t("openVisit")}
            </Link>
          </Button>
        )}
        {row.status === "with_doctor" && !openVisit && can(P.visitsComplete, P.billingCharge) && (
          <Button size="sm" variant="outline" onClick={() => move("awaiting_checkout")} disabled={pending}>
            <Receipt />
            {t("finish")}
          </Button>
        )}
        {row.status === "awaiting_checkout" && can(P.accountingCreate) && (
          <Button size="sm" variant={balance > 0.0005 ? "outline" : "default"} onClick={() => (needsReason("checked_out") ? setAsk("checked_out") : move("checked_out"))} disabled={pending}>
            <DoorOpen />
            {t("checkout")}
          </Button>
        )}
        {(row.status === "waiting_payment" || row.status === "waiting_doctor") && can(P.encountersCreate) && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setAsk("cancelled")} disabled={pending}>
            <Ban />
            {t("cancel")}
          </Button>
        )}
      </div>

      {startOpen && (
        <StartVisitDialog
          open
          onOpenChange={setStartOpen}
          patientId={row.patient_id}
          appointmentId={row.appointment_id}
          encounterId={row.id}
        />
      )}
      <ReasonDialog
        open={!!ask}
        onOpenChange={(o) => !o && setAsk(null)}
        onConfirm={(r) => {
          const status = ask
          setAsk(null)
          if (status) move(status, r)
        }}
      />
    </li>
  )
})

/** Lane count summary for the dashboard header. */
export function QueueCounts({ rows }: { rows: QueueEncounter[] }) {
  const t = useTranslations("encounters")
  const waiting = rows.filter((r) => r.status === "waiting_doctor").length
  const payment = rows.filter((r) => r.status === "waiting_payment" || r.status === "awaiting_checkout").length
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Users className="size-3.5" />
      {t("countsSummary", { waiting, payment })}
    </span>
  )
}
