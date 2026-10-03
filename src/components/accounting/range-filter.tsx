"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { DateInput } from "@/components/common/date-input"
import { cn } from "@/lib/utils"
import type { RangeKey } from "@/lib/accounting/ranges"

/** Today · Yesterday · This week · This month · Custom range (kept in the URL). */
export function RangeFilter({ range }: { range: { key: RangeKey; from: string; to: string } }) {
  const t = useTranslations("accounting.ranges")
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    router.push(`${pathname}?${next}`)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["today", "yesterday", "week", "month", "custom"] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => go(k === "custom" ? { range: k, from: range.from, to: range.to } : { range: k, from: null, to: null })}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            range.key === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {t(k)}
        </button>
      ))}
      {range.key === "custom" && (
        <div className="flex items-center gap-2">
          <DateInput value={range.from} onChange={(v) => v && go({ range: "custom", from: v })} aria-label={t("from")} className="w-36" />
          <span className="text-muted-foreground">–</span>
          <DateInput value={range.to} onChange={(v) => v && go({ range: "custom", to: v })} aria-label={t("to")} className="w-36" />
        </div>
      )}
    </div>
  )
}
