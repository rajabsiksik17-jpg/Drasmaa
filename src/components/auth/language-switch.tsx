"use client"


import { useLocale } from "next-intl"
import { Globe, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { setLocale } from "@/lib/actions/account"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export function LanguageSwitch() {
  const locale = useLocale()
  const [pending, start] = useSafeTransition()
  const next = locale === "ar" ? "en" : "ar"
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => void (await setLocale(next)))}>
      {pending ? <Loader2 className="animate-spin" /> : <Globe />}
      {next === "ar" ? "العربية" : "English"}
    </Button>
  )
}
