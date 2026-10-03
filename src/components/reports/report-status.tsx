import { getTranslations } from "next-intl/server"
import { cn } from "@/lib/utils"

export async function ReportStatusBadgeServer({ status }: { status: "draft" | "final" | "void" }) {
  const t = await getTranslations("medicalReports.status")
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "final" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : status === "void" ? "bg-destructive/12 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      )}
    >
      {t(status)}
    </span>
  )
}
