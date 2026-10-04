"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { changePassword } from "@/lib/actions/account"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export function NewPasswordForm() {
  const t = useTranslations("auth")
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useSafeTransition()

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (password.length < 10) return setError(t("passwordTooShort"))
        if (password !== confirm) return setError(t("passwordMismatch"))
        start(async () => {
          const res = await changePassword(password)
          if (!res.ok) return setError(t("passwordTooShort"))
          toast.success(t("passwordChanged"))
          router.replace("/dashboard")
        })
      }}
    >
      <h1 className="text-2xl font-semibold tracking-tight">{t("newPassword")}</h1>
      <div className="space-y-1.5">
        <Label htmlFor="pw">{t("password")}</Label>
        <Input id="pw" type="password" autoComplete="new-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw2">{t("confirmPassword")}</Label>
        <Input id="pw2" type="password" autoComplete="new-password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-10" />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("savePassword")}
      </Button>
    </form>
  )
}
