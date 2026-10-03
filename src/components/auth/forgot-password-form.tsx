"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowLeft, Loader2, MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestPasswordReset } from "@/lib/actions/auth"

export function ForgotPasswordForm() {
  const t = useTranslations("auth")
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle")
  const [limited, setLimited] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.includes("@")) return
    setState("sending")
    // Always show the same confirmation (no account enumeration).
    const res = await requestPasswordReset({ email })
    if (!res.ok && res.error.code === "rateLimited") {
      setState("idle")
      setLimited(true)
      return
    }
    setState("sent")
  }

  if (state === "sent") {
    return (
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto size-10 text-primary" />
        <h1 className="text-xl font-semibold">{t("checkEmail")}</h1>
        <p className="text-sm text-muted-foreground">{t("checkEmailBody")}</p>
        <Button variant="outline" asChild>
          <Link href="/login">{t("backToLogin")}</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("resetTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("resetHint")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" required />
      </div>
      {limited && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("tooManyAttempts")}
        </p>
      )}
      <Button type="submit" className="h-10 w-full" disabled={state === "sending"}>
        {state === "sending" && <Loader2 className="animate-spin" />}
        {t("sendReset")}
      </Button>
      <Link href="/login" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("backToLogin")}
      </Link>
    </form>
  )
}
