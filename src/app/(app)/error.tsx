"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { AlertTriangle, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Friendly error screen; technical details stay in the logs. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorPage")
  useEffect(() => {
    console.error(`[ui] ${error.digest ?? error.name}`)
  }, [error])
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </span>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">{t("reference", { id: error.digest })}</p>}
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCw />
          {t("retry")}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">{t("home")}</Link>
        </Button>
      </div>
    </div>
  )
}
