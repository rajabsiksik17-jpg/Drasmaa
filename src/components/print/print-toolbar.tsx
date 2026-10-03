"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Printer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRefs } from "@/components/app-context"

export function PrintToolbar() {
  const t = useTranslations("print")
  const refs = useRefs()
  const params = useSearchParams()
  useEffect(() => {
    if (params.get("autoprint") === "1") setTimeout(() => window.print(), 600)
  }, [params])
  return (
    <div className="no-print mx-auto mb-4 flex max-w-[297mm] items-center gap-2 px-3">
      <span className="text-sm font-medium">{refs.clinicName}</span>
      <span className="text-xs text-muted-foreground">· {t("hint")}</span>
      <Button size="sm" className="ms-auto" onClick={() => window.print()}>
        <Printer />
        {t("print")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.close()}>
        <X />
        {t("close")}
      </Button>
    </div>
  )
}

/** Clinic letterhead used on printed sheets (from Admin → Clinic settings). */
export function PrintHeader({ title, subtitle }: { title?: string; subtitle?: string }) {
  const refs = useRefs()
  return (
    <div className="mb-3 flex items-end justify-between border-b border-black/70 pb-2 text-black">
      <div>
        <p className="text-[15px] font-bold">{refs.settings.clinic_name_en}</p>
        <p className="text-[12px]" dir="rtl">
          {refs.settings.clinic_name_ar}
        </p>
      </div>
      <div className="text-end text-[11px]">
        {title && <p className="text-[13px] font-semibold">{title}</p>}
        {subtitle && <p>{subtitle}</p>}
        <p dir="ltr">{[refs.settings.phone, refs.settings.address_en].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  )
}
