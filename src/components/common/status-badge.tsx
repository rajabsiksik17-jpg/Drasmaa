"use client"

import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import type { AppointmentStatus, VisitStatus } from "@/types/db"

const APPT_STYLES: Record<AppointmentStatus, string> = {
  scheduled: "bg-muted text-muted-foreground border-border",
  checked_in: "bg-status-waiting/15 text-[color:oklch(0.45_0.12_70)] dark:text-status-waiting border-status-waiting/30",
  with_doctor: "bg-status-with-doctor/12 text-status-with-doctor border-status-with-doctor/30",
  completed: "bg-status-completed/12 text-status-completed border-status-completed/30",
  cancelled: "bg-status-cancelled/10 text-status-cancelled border-status-cancelled/25 line-through decoration-1",
  no_show: "bg-status-cancelled/10 text-status-cancelled border-status-cancelled/25",
  rescheduled: "bg-muted text-muted-foreground border-border italic",
}

export function AppointmentStatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  const t = useTranslations("status")
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.9, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", APPT_STYLES[status], className)}
    >
      {(status === "checked_in" || status === "with_doctor") && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {t(status)}
    </motion.span>
  )
}

const VISIT_STYLES: Record<VisitStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-status-with-doctor/12 text-status-with-doctor",
  completed: "bg-status-completed/12 text-status-completed",
  cancelled: "bg-status-cancelled/10 text-status-cancelled",
}

export function VisitStatusBadge({ status, className }: { status: VisitStatus; className?: string }) {
  const t = useTranslations("visitStatus")
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", VISIT_STYLES[status], className)}>
      {t(status)}
    </span>
  )
}

export function CaseStatusBadge({ status }: { status: string }) {
  const t = useTranslations("caseStatus")
  const active = status === "active"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {t(status)}
    </span>
  )
}
