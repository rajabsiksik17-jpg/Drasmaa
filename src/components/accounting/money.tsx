"use client"

import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { InvoiceStatus } from "@/types/db"

/** Locale-aware money (JOD: 3 decimals). Always LTR digits so totals align. */
export function formatMoney(value: number, currency: string, locale: string) {
  const digits = currency === "JOD" || currency === "KWD" || currency === "BHD" ? 3 : 2
  return new Intl.NumberFormat(locale === "ar" ? "ar-JO-u-nu-latn" : "en-JO", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0)
}

export function Money({ value, currency, className }: { value: number; currency: string; className?: string }) {
  const locale = useLocale()
  return (
    <span dir="ltr" className={cn("tabular-nums", className)}>
      {formatMoney(value, currency, locale)}
    </span>
  )
}

const TONE: Record<InvoiceStatus, string> = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  partially_paid: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  paid: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  no_charge: "bg-muted text-muted-foreground",
  refunded: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  void: "bg-destructive/12 text-destructive",
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const t = useTranslations("accounting.status")
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[status])}>{t(status)}</span>
}
