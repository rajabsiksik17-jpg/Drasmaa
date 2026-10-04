"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Fingerprint, Loader2, LockKeyhole, ShieldCheck, Timer } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { saveSecurityPolicy } from "@/lib/actions/security"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface SecurityPolicy {
  otp_mode: "disabled" | "new_device" | "every_login"
  otp_scope: "all" | "roles"
  otp_length: number
  otp_ttl_seconds: number
  otp_max_attempts: number
  otp_resend_cooldown_seconds: number
  otp_max_sends_per_hour: number
  trusted_device_days: number
  login_max_failures: number
  login_lockout_minutes: number
}

type Role = { id: string; code: string; name_en: string; name_ar: string }

export function AuthenticationSettings({
  policy,
  roles,
  requiredRoles,
  emailReady,
}: {
  policy: SecurityPolicy
  roles: Role[]
  requiredRoles: string[]
  emailReady: boolean
}) {
  const t = useTranslations("authSettings")
  const locale = useLocale()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [v, setV] = useState({ ...policy, otp_roles: requiredRoles })

  const num = (key: keyof SecurityPolicy, label: string, min: number, max: number, suffix?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`as-${key}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`as-${key}`}
          type="number"
          min={min}
          max={max}
          dir="ltr"
          value={v[key] as number}
          onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
          className="w-28"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )

  const save = () =>
    start(async () => {
      const res = await saveSecurityPolicy({
        otp_mode: v.otp_mode,
        otp_scope: v.otp_scope,
        otp_roles: v.otp_roles,
        otp_ttl_seconds: v.otp_ttl_seconds,
        otp_max_attempts: v.otp_max_attempts,
        otp_resend_cooldown_seconds: v.otp_resend_cooldown_seconds,
        otp_max_sends_per_hour: v.otp_max_sends_per_hour,
        trusted_device_days: v.trusted_device_days,
        login_max_failures: v.login_max_failures,
        login_lockout_minutes: v.login_lockout_minutes,
      })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  const modes = ["disabled", "new_device", "every_login"] as const

  return (
    <div className="space-y-5">
      <SectionCard title={t("otp")} icon={Fingerprint}>
        <div className="space-y-5">
          {!emailReady && (
            <p className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                {t("emailRequired")}{" "}
                <Link href="/admin/email" className="font-medium underline">
                  {t("configureEmail")}
                </Link>
              </span>
            </p>
          )}
          <div role="radiogroup" aria-label={t("mode")} className="grid gap-2 sm:grid-cols-3">
            {modes.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={v.otp_mode === m}
                onClick={() => setV({ ...v, otp_mode: m })}
                className={cn(
                  "rounded-xl border p-3 text-start transition",
                  v.otp_mode === m ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20" : "hover:bg-muted/50",
                )}
              >
                <span className="block text-sm font-semibold">{t(`modes.${m}.title`)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t(`modes.${m}.hint`)}</span>
              </button>
            ))}
          </div>

          {v.otp_mode !== "disabled" && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("appliesTo")}</p>
              <div className="flex flex-wrap gap-2">
                {(["all", "roles"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setV({ ...v, otp_scope: s })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      v.otp_scope === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {t(`scope.${s}`)}
                  </button>
                ))}
              </div>
              {v.otp_scope === "roles" && (
                <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/20 p-3">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={v.otp_roles.includes(r.id)}
                        onCheckedChange={(c) =>
                          setV({ ...v, otp_roles: c === true ? [...v.otp_roles, r.id] : v.otp_roles.filter((x) => x !== r.id) })
                        }
                      />
                      {locale === "ar" ? r.name_ar : r.name_en}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {num("otp_ttl_seconds", t("ttl"), 60, 900, t("seconds"))}
            {num("otp_max_attempts", t("maxAttempts"), 3, 10)}
            {num("otp_resend_cooldown_seconds", t("cooldown"), 30, 600, t("seconds"))}
            {num("otp_max_sends_per_hour", t("maxSends"), 2, 20)}
            {num("trusted_device_days", t("trustedDays"), 1, 180, t("days"))}
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("lockout")} icon={LockKeyhole}>
        <div className="grid gap-4 sm:grid-cols-2">
          {num("login_max_failures", t("maxFailures"), 3, 20)}
          {num("login_lockout_minutes", t("lockoutMinutes"), 1, 1440, t("minutes"))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Timer className="size-3.5" />
          {t("rateNote")}
        </p>
      </SectionCard>

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {t("auditNote")}
        </p>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {t("save")}
        </Button>
      </div>
    </div>
  )
}
