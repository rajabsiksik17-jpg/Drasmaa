"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion } from "motion/react"
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn } from "@/lib/actions/auth"

const schema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export function LoginForm({ next, notice }: { next: string; notice?: "revoked" | "signed_out" | null }) {
  const t = useTranslations("auth")
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } })

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    const res = await signIn({ ...values, next })
    if (!res.ok) {
      const code = res.error.code
      setError(
        code === "unauthenticated"
          ? t("invalidCredentials")
          : code === "accountLocked"
            ? t("accountLocked", { minutes: res.error.detail ?? 15 })
            : code === "rateLimited"
              ? t("tooManyAttempts")
              : code === "forbidden"
                ? t("accountDisabled")
                : t("signInFailed"),
      )
      return
    }
    router.replace(res.data.next)
    router.refresh()
  })

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("welcome")}</h1>
        <p className="text-sm text-muted-foreground">{t("signInHint")}</p>
      </div>
      {notice && (
        <p role="status" className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t(notice === "revoked" ? "sessionRevokedNotice" : "sessionEndedNotice")}
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" type="email" autoComplete="username" dir="ltr" className="h-10" {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
          {form.formState.errors.email && <p className="text-xs text-destructive">{t("emailInvalid")}</p>}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              {t("forgot")}
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              dir="ltr"
              className="h-10 pe-10"
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 end-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
              aria-label={show ? t("hidePassword") : t("showPassword")}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </motion.p>
        )}
        <Button type="submit" className="h-10 w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <LogIn className="rtl:-scale-x-100" />}
          {t("signIn")}
        </Button>
      </form>
    </motion.div>
  )
}
