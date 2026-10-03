"use client"

import { useTransition } from "react"
import { useLocale } from "next-intl"
import { Globe, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { setLocale } from "@/lib/actions/account"

export function LanguageSwitch() {
  const locale = useLocale()
  const [pending, start] = useTransition()
  const next = locale === "ar" ? "en" : "ar"
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => void (await setLocale(next)))}>
      {pending ? <Loader2 className="animate-spin" /> : <Globe />}
      {next === "ar" ? "العربية" : "English"}
    </Button>
  )
}
