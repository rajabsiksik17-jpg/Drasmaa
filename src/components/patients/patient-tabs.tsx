"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

export type PatientTabKey =
  | "overview"
  | "personal"
  | "medical"
  | "visits"
  | "appointments"
  | "fertility"
  | "pregnancy"
  | "oi"
  | "investigations"
  | "prescriptions"
  | "drawings"
  | "reports"
  | "billing"
  | "documents"
  | "communications"
  | "timeline"
  | "audit"

export function PatientTabs({ current, available }: { current: PatientTabKey; available: PatientTabKey[] }) {
  const t = useTranslations("patient.tabs")
  const params = useSearchParams()
  return (
    <nav className="no-print -mx-1 overflow-x-auto px-1 pb-0.5" aria-label={t("label")}>
      <div role="tablist" className="flex min-w-max gap-0.5 border-b">
        {available.map((tab) => {
          const next = new URLSearchParams(params)
          next.set("tab", tab)
          const active = tab === current
          return (
            <Link
              key={tab}
              role="tab"
              aria-selected={active}
              href={`?${next.toString()}`}
              scroll={false}
              className={cn(
                "relative px-3 pt-1.5 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(tab)}
              {active && (
                <motion.span
                  layoutId="patient-tab-underline"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
