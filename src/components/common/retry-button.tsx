"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Re-runs the server queries of the current view (no full page reload). */
export function RetryButton({ size = "sm" }: { size?: "sm" | "default" }) {
  const t = useTranslations("common")
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button size={size} variant="outline" onClick={() => start(() => router.refresh())} disabled={pending} aria-live="polite">
      {pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
      {pending ? t("retrying") : t("retry")}
    </Button>
  )
}
