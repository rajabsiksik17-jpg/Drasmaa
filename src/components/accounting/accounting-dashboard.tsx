"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { motion } from "motion/react"
import { Banknote, CreditCard, HandCoins, Percent, Receipt, RotateCcw, ShieldCheck, Stethoscope, TrendingUp, Users, Wallet, type LucideIcon } from "lucide-react"
import { SectionCard } from "@/components/common/page"
import { RangeFilter } from "@/components/accounting/range-filter"
import { Money } from "@/components/accounting/money"
import { formatDate } from "@/lib/dates"
import type { RangeKey } from "@/lib/accounting/ranges"
import { cn } from "@/lib/utils"

export interface AccountingSummary {
  revenue: number
  discounts: number
  invoices: number
  paid_visits: number
  unpaid_visits: number
  services: number
  collected: number
  cash: number
  card: number
  insurance_received: number
  refunds: number
  insurance_billed: number
  outstanding_insurance: number
  patient_balances: number
  by_method: { method: string; amount: number }[]
  by_doctor: { doctor_id: string | null; name_en: string | null; name_ar: string | null; amount: number; count: number }[]
  by_service: { service_id: string | null; name_en: string; name_ar: string; amount: number; count: number }[]
  by_insurance: { insurance_company_id: string; name_en: string; name_ar: string; billed: number; outstanding: number }[]
  daily: { day: string; revenue: number; collected: number }[]
}

function Stat({ label, value, icon: Icon, tone = "default", currency, count, href }: { label: string; value: number; icon: LucideIcon; tone?: "default" | "good" | "warn" | "muted"; currency?: string; count?: boolean; href?: string }) {
  const tones = {
    default: "bg-primary/10 text-primary",
    good: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    muted: "bg-muted text-muted-foreground",
  }
  const body = (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition hover:shadow-sm">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tones[tone])}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{count || !currency ? <span className="tabular-nums">{Number(value) || 0}</span> : <Money value={value} currency={currency} />}</p>
      </div>
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

function Bars({ rows, currency }: { rows: { label: string; amount: number; sub?: string }[]; currency: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.amount)))
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">—</p>
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={i} className="space-y-1">
          <div className="flex justify-between gap-3 text-sm">
            <span className="truncate">
              {r.label}
              {r.sub && <span className="ms-1.5 text-xs text-muted-foreground">{r.sub}</span>}
            </span>
            <Money value={r.amount} currency={currency} className="font-medium" />
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(Number(r.amount) / max) * 100}%` }} className="h-full rounded-full bg-primary" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function AccountingDashboard({ range, summary, currency }: { range: { key: RangeKey; from: string; to: string }; summary: AccountingSummary | null; currency: string }) {
  const t = useTranslations("accounting")
  const locale = useLocale()
  const ar = locale === "ar"
  const s = summary
  const maxDaily = Math.max(1, ...(s?.daily ?? []).map((d) => Math.max(Number(d.revenue), Number(d.collected))))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeFilter range={range} />
        <p className="text-xs text-muted-foreground">
          {formatDate(range.from)}
          {range.to !== range.from && ` – ${formatDate(range.to)}`}
        </p>
      </div>
      {!s ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noData")}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("kpi.revenue")} value={s.revenue} icon={TrendingUp} currency={currency} />
            <Stat label={t("kpi.collected")} value={s.collected} icon={HandCoins} tone="good" currency={currency} />
            <Stat label={t("kpi.cash")} value={s.cash} icon={Banknote} tone="good" currency={currency} href="/accounting/register" />
            <Stat label={t("kpi.card")} value={s.card} icon={CreditCard} currency={currency} />
            <Stat label={t("kpi.insuranceReceived")} value={s.insurance_received} icon={ShieldCheck} currency={currency} />
            <Stat label={t("kpi.outstandingInsurance")} value={s.outstanding_insurance} icon={ShieldCheck} tone="warn" currency={currency} href="/accounting/insurance" />
            <Stat label={t("kpi.patientBalances")} value={s.patient_balances} icon={Wallet} tone="warn" currency={currency} href="/accounting/invoices?status=unpaid" />
            <Stat label={t("kpi.discounts")} value={s.discounts} icon={Percent} tone="muted" currency={currency} />
            <Stat label={t("kpi.refunds")} value={s.refunds} icon={RotateCcw} tone="muted" currency={currency} />
            <Stat label={t("kpi.services")} value={s.services} icon={Stethoscope} tone="muted" count />
            <Stat label={t("kpi.paidVisits")} value={s.paid_visits} icon={Receipt} tone="good" count />
            <Stat label={t("kpi.unpaidVisits")} value={s.unpaid_visits} icon={Users} tone="warn" count href="/accounting/invoices?status=unpaid" />
          </div>

          {s.daily.length > 1 && (
            <SectionCard title={t("cashFlow")} icon={TrendingUp}>
              <div className="flex h-40 items-end gap-1 overflow-x-auto" dir="ltr">
                {s.daily.map((d) => (
                  <div key={d.day} className="group flex min-w-6 flex-1 flex-col items-center justify-end gap-0.5" title={`${formatDate(d.day)}`}>
                    <div className="flex w-full items-end justify-center gap-0.5" style={{ height: "8.5rem" }}>
                      <motion.div initial={{ height: 0 }} animate={{ height: `${(Number(d.revenue) / maxDaily) * 100}%` }} className="w-1/2 rounded-t bg-primary/40" />
                      <motion.div initial={{ height: 0 }} animate={{ height: `${(Number(d.collected) / maxDaily) * 100}%` }} className="w-1/2 rounded-t bg-primary" />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{d.day.slice(8)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-primary/40" />
                  {t("kpi.revenue")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-primary" />
                  {t("kpi.collected")}
                </span>
              </p>
            </SectionCard>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title={t("byService")} icon={Stethoscope}>
              <Bars currency={currency} rows={s.by_service.map((r) => ({ label: ar ? r.name_ar : r.name_en, amount: r.amount, sub: `× ${r.count}` }))} />
            </SectionCard>
            <SectionCard title={t("byDoctor")} icon={Users}>
              <Bars currency={currency} rows={s.by_doctor.map((r) => ({ label: (ar ? r.name_ar : r.name_en) ?? t("noDoctor"), amount: r.amount, sub: `(${r.count})` }))} />
            </SectionCard>
            <SectionCard title={t("byMethod")} icon={CreditCard}>
              <Bars currency={currency} rows={s.by_method.map((r) => ({ label: t(`methods.${r.method}`), amount: r.amount }))} />
            </SectionCard>
            <SectionCard title={t("byInsurance")} icon={ShieldCheck}>
              <Bars currency={currency} rows={s.by_insurance.map((r) => ({ label: ar ? r.name_ar : r.name_en, amount: r.billed, sub: t("outstandingShort", { value: Number(r.outstanding).toFixed(3) }) }))} />
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}
