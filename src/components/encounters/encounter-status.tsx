"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { EncounterStatus } from "@/types/db"

const STYLES: Record<EncounterStatus, string> = {
  waiting_payment: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  waiting_doctor: "bg-status-waiting/15 text-[color:oklch(0.45_0.12_70)] dark:text-status-waiting border-status-waiting/30",
  called: "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/30",
  with_doctor: "bg-status-with-doctor/12 text-status-with-doctor border-status-with-doctor/30",
  awaiting_checkout: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30",
  checked_out: "bg-status-completed/12 text-status-completed border-status-completed/30",
  cancelled: "bg-status-cancelled/10 text-status-cancelled border-status-cancelled/25",
}

/**
 * Queue status of a clinic visit. After the doctor, the label depends on
 * the payment workflow: "bill finalized / waiting for payment" when payment
 * comes after the consultation, "ready for checkout" otherwise.
 */
export function EncounterStatusBadge({ status, prepay, className }: { status: EncounterStatus; prepay: boolean; className?: string }) {
  const t = useTranslations("encounters.status")
  const key = status === "awaiting_checkout" && !prepay ? "bill_finalized" : status
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", STYLES[status], className)}>
      {(status === "waiting_doctor" || status === "called" || status === "with_doctor") && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {t(key)}
    </span>
  )
}
