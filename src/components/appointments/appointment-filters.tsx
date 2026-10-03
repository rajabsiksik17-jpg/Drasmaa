"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { ChevronLeft, ChevronRight, FilterX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/common/native-select"
import { useRefs } from "@/components/app-context"
import { cn } from "@/lib/utils"

const TABS = ["today", "tomorrow", "upcoming", "previous", "calendar"] as const

export function AppointmentTabs({ current }: { current: string }) {
  const t = useTranslations("appointments.tabs")
  const params = useSearchParams()
  return (
    <div className="no-print -mx-1 overflow-x-auto px-1">
      <div role="tablist" className="inline-flex gap-1 rounded-xl border bg-muted/40 p-1">
        {TABS.map((tab) => {
          const next = new URLSearchParams(params)
          next.set("tab", tab)
          next.delete("page")
          const active = current === tab
          return (
            <Link
              key={tab}
              role="tab"
              aria-selected={active}
              href={`?${next.toString()}`}
              scroll={false}
              className={cn(
                "relative rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span layoutId="appt-tab" className="absolute inset-0 rounded-lg bg-background shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
              )}
              <span className="relative">{t(tab)}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function AppointmentFilters() {
  const t = useTranslations("appointments")
  const refs = useRefs()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete("page")
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  const any = ["doctor", "dept", "type", "status"].some((k) => params.get(k))
  const statuses = ["scheduled", "checked_in", "with_doctor", "completed", "cancelled", "no_show", "rescheduled"] as const
  const ts = useTranslations("status")

  return (
    <div className="no-print grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <NativeSelect aria-label={t("doctor")} value={params.get("doctor") ?? ""} onChange={(e) => set("doctor", e.target.value)} className="h-8 sm:w-44">
        <option value="">{t("allDoctors")}</option>
        {refs.activeDoctors(params.get("doctor")).map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={t("department")} value={params.get("dept") ?? ""} onChange={(e) => set("dept", e.target.value)} className="h-8 sm:w-40">
        <option value="">{t("allDepartments")}</option>
        {refs.activeDepartments(params.get("dept")).map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={t("visitType")} value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)} className="h-8 sm:w-40">
        <option value="">{t("allTypes")}</option>
        {refs.activeOptions("appointment_type", params.get("type")).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label={t("status")} value={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} className="h-8 sm:w-36">
        <option value="">{t("allStatuses")}</option>
        {statuses.map((s) => (
          <option key={s} value={s}>{ts(s)}</option>
        ))}
      </NativeSelect>
      {any && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = new URLSearchParams(params)
            for (const k of ["doctor", "dept", "type", "status", "page"]) next.delete(k)
            router.replace(`${pathname}?${next.toString()}`, { scroll: false })
          }}
        >
          <FilterX />
          {t("clearFilters")}
        </Button>
      )}
    </div>
  )
}

export function Pager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const t = useTranslations("common")
  const params = useSearchParams()
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  const href = (p: number) => {
    const next = new URLSearchParams(params)
    next.set("page", String(p))
    return `?${next.toString()}`
  }
  return (
    <div className="no-print mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>{t("pageOf", { page: page + 1, pages, total })}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" asChild disabled={page === 0}>
          <Link href={href(Math.max(0, page - 1))} aria-disabled={page === 0} className={cn(page === 0 && "pointer-events-none opacity-50")}>
            <ChevronLeft className="rtl:-scale-x-100" />
            {t("previous")}
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={href(Math.min(pages - 1, page + 1))} aria-disabled={page >= pages - 1} className={cn(page >= pages - 1 && "pointer-events-none opacity-50")}>
            {t("next")}
            <ChevronRight className="rtl:-scale-x-100" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
