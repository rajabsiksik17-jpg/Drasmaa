"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { motion } from "motion/react"
import {
  Baby,
  CalendarDays,
  CheckCircle2,
  FileDown,
  FileSignature,
  FileText,
  PenTool,
  Pill,
  Receipt,
  Wallet,
  FlaskConical,
  HeartPulse,
  LogIn,
  Stethoscope,
  UserPlus,
  type LucideIcon,
} from "lucide-react"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { TimelineEvent } from "@/types/db"

const ICONS: Record<TimelineEvent["event_type"], { icon: LucideIcon; tone: string }> = {
  patient_created: { icon: UserPlus, tone: "bg-muted text-muted-foreground" },
  appointment: { icon: CalendarDays, tone: "bg-primary/10 text-primary" },
  checked_in: { icon: LogIn, tone: "bg-status-waiting/15 text-status-waiting" },
  visit: { icon: Stethoscope, tone: "bg-status-with-doctor/12 text-status-with-doctor" },
  fertility_case: { icon: FlaskConical, tone: "bg-primary/10 text-primary" },
  pregnancy_case: { icon: Baby, tone: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
  oi_cycle_started: { icon: HeartPulse, tone: "bg-primary/10 text-primary" },
  oi_cycle_completed: { icon: CheckCircle2, tone: "bg-status-completed/12 text-status-completed" },
  document: { icon: FileText, tone: "bg-muted text-muted-foreground" },
  drawing: { icon: PenTool, tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  prescription: { icon: Pill, tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  medical_report: { icon: FileSignature, tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  invoice: { icon: Receipt, tone: "bg-muted text-muted-foreground" },
  payment: { icon: Wallet, tone: "bg-muted text-muted-foreground" },
  generated_document: { icon: FileDown, tone: "bg-muted text-muted-foreground" },
}

export function timelineHref(patientId: string, e: TimelineEvent) {
  const base = `/patients/${patientId}`
  switch (e.event_type) {
    case "visit":
      return `${base}/visits/${e.entity_id}`
    case "pregnancy_case":
      return `${base}/pregnancies/${e.entity_id}`
    case "oi_cycle_started":
    case "oi_cycle_completed":
      return `${base}/cycles/${e.entity_id}`
    case "fertility_case":
      return `${base}?tab=fertility`
    case "document":
    case "generated_document":
      return `${base}?tab=documents`
    case "drawing":
      return `${base}/drawings/${e.entity_id}`
    case "prescription":
      return `${base}?tab=prescriptions`
    case "medical_report":
      return `/reports/${e.entity_id}`
    case "invoice":
      return `/accounting/invoices/${e.entity_id}`
    case "payment":
      return `${base}?tab=billing`
    case "appointment":
    case "checked_in":
      return `${base}?tab=appointments`
    default:
      return `${base}?tab=personal`
  }
}

/** Chronological list generated from real records; every item opens its record. */
export function PatientTimeline({ patientId, events, compact = false }: { patientId: string; events: TimelineEvent[]; compact?: boolean }) {
  const t = useTranslations("timeline")
  const locale = useLocale()
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>
  return (
    <ol className="relative space-y-1 ps-1">
      <span aria-hidden className="absolute inset-y-2 start-[19px] w-px bg-border" />
      {events.map((e, i) => {
        const { icon: Icon, tone } = ICONS[e.event_type] ?? ICONS.document
        const sub = e.subtype ? t.has(`subtype.${e.subtype}`) ? t(`subtype.${e.subtype}`) : e.subtype : ""
        return (
          <motion.li
            key={`${e.event_type}-${e.entity_id}-${i}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.02, 0.3) }}
          >
            <Link href={timelineHref(patientId, e)} className="group relative flex gap-3 rounded-lg p-1.5 hover:bg-muted/50">
              <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-card", tone)}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block text-sm font-medium group-hover:text-primary">
                  {t(`event.${e.event_type}`, { number: e.number ?? "" })}
                  {sub && <span className="font-normal text-muted-foreground"> · {sub}</span>}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(e.occurred_at, locale)}
                  {e.status && !compact && <> · {t.has(`status.${e.status}`) ? t(`status.${e.status}`) : e.status}</>}
                </span>
              </span>
            </Link>
          </motion.li>
        )
      })}
    </ol>
  )
}
