"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { Loader2, LogOut, MailCheck, RotateCw, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { endSession, resendOtp, startVerification, verifyOtp, type VerificationState } from "@/lib/actions/auth"
import { useNow } from "@/hooks/use-hydration"
import { useSafeTransition } from "@/hooks/use-safe-transition"

/** Second step of sign-in: the emailed one-time code. */
export function OtpForm({ next }: { next: string }) {
  const t = useTranslations("auth.otp")
  const router = useRouter()
  const [state, setState] = useState<VerificationState | null>(null)
  const [code, setCode] = useState("")
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useSafeTransition()
  const started = useRef(false)
  const now = useNow(1000)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void startVerification().then((res) => {
      if (!res.ok) return setState({ status: "pending_otp", error: "emailFailed" })
      if (res.data.status === "active") return router.replace(next)
      if (res.data.status === "ended") return router.replace("/login")
      setState(res.data)
    })
  }, [next, router])

  const secondsUntil = (iso?: string) => (iso && now != null ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0)
  const resendIn = secondsUntil(state?.resendAt)
  const expiresIn = secondsUntil(state?.expiresAt)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6,8}$/.test(code)) return setError(t("enterCode"))
    setError(null)
    startTransition(async () => {
      const res = await verifyOtp({ code, remember })
      if (res.ok) {
        router.replace(next)
        router.refresh()
        return
      }
      setCode("")
      const c = res.error.code
      setError(
        c === "otpInvalid"
          ? t("wrongCode", { remaining: res.error.detail ?? 0 })
          : c === "otpExpired"
            ? t("expired")
            : c === "otpLocked"
              ? t("locked")
              : c === "rateLimited"
                ? t("tooMany")
                : c === "unauthenticated"
                  ? t("sessionEnded")
                  : t("failed"),
      )
    })
  }

  const resend = () =>
    startTransition(async () => {
      setError(null)
      const res = await resendOtp()
      if (res.ok) {
        setState((s) => (s ? { ...s, ...res.data, error: undefined } : s))
        return
      }
      const c = res.error.code
      setError(
        c === "otpCooldown"
          ? t("cooldown", { seconds: res.error.detail ?? 60 })
          : c === "rateLimited"
            ? t("tooManySends")
            : c === "emailNotConfigured"
              ? t("emailNotConfigured")
              : t("sendFailed"),
      )
    })

  const cancel = () =>
    startTransition(async () => {
      await endSession()
      router.replace("/login")
      router.refresh()
    })

  if (!state) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        {t("preparing")}
      </div>
    )
  }

  const sendError =
    state.error === "emailNotConfigured" ? t("emailNotConfigured") : state.error === "rateLimited" ? t("tooManySends") : state.error ? t("sendFailed") : null

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="space-y-2">
        <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {sendError ? t("notSent") : t("sentTo")}{" "}
          {!sendError && (
            <span dir="ltr" className="font-medium text-foreground">
              {state.email}
            </span>
          )}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="otp">{t("code")}</Label>
          <input
            id="otp"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            dir="ltr"
            maxLength={8}
            aria-invalid={!!error}
            className="h-14 w-full rounded-lg border border-input bg-background text-center font-mono text-2xl tracking-[0.5em] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
            placeholder="••••••"
          />
          {expiresIn > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("expiresIn", { time: `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}` })}
            </p>
          )}
        </div>

        {state.rememberAllowed && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
            {t("remember")}
          </label>
        )}

        {(error || sendError) && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error ?? sendError}
          </motion.p>
        )}

        <Button type="submit" className="h-10 w-full" disabled={pending || code.length < 6}>
          {pending ? <Loader2 className="animate-spin" /> : <MailCheck />}
          {t("verify")}
        </Button>
      </form>

      <div className="flex items-center justify-between gap-2 text-sm">
        <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={pending || resendIn > 0}>
          <RotateCw />
          {resendIn > 0 ? t("resendIn", { seconds: resendIn }) : t("resend")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={pending}>
          <LogOut className="rtl:-scale-x-100" />
          {t("cancel")}
        </Button>
      </div>
    </motion.div>
  )
}
