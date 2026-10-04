"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import Link from "next/link"
import { Bell, ChevronRight, Globe, KeyRound, LayoutGrid, Loader2, Monitor, Moon, ShieldCheck, Sun } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SectionCard } from "@/components/common/page"
import { changePassword, setLocale, updatePreferences } from "@/lib/actions/account"
import { cn } from "@/lib/utils"
import { useHydrated } from "@/hooks/use-hydration"
import type { UserPreferences } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
            value === o.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PreferencesForm({
  preferences,
  email,
  children,
}: {
  preferences: UserPreferences
  email: string | null
  /** Per-event notification switches (rendered inside the notifications card). */
  children?: React.ReactNode
}) {
  const t = useTranslations("settings")
  const locale = useLocale()
  const { theme, setTheme } = useTheme()
  // The theme is only known in the browser; render the server default until hydrated.
  const hydrated = useHydrated()
  const [pending, start] = useSafeTransition()
  const [prefs, setPrefs] = useState(preferences)
  const [pw, setPw] = useState("")

  const save = (patch: Partial<UserPreferences>) => {
    setPrefs((p) => ({ ...p, ...patch }))
    start(async () => {
      const res = await updatePreferences(patch)
      if (res.ok) toast.success(t("saved"))
      else toast.error(t("saveFailed"))
    })
  }

  return (
    <div className="space-y-5">
      <SectionCard title={t("appearance")} icon={LayoutGrid}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label className="flex items-center gap-2"><Globe className="size-4" />{t("language")}</Label>
            <Choice
              value={locale as "en" | "ar"}
              options={[
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
              onChange={(l) => start(async () => void (await setLocale(l)))}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label>{t("theme")}</Label>
            <Choice
              value={(hydrated ? (theme ?? "light") : "light") as "light" | "dark" | "system"}
              options={[
                { value: "light", label: t("light"), icon: <Sun className="size-4" /> },
                { value: "dark", label: t("dark"), icon: <Moon className="size-4" /> },
                { value: "system", label: t("system"), icon: <Monitor className="size-4" /> },
              ]}
              onChange={setTheme}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("paperNote")}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label>{t("density")}</Label>
            <Choice
              value={prefs.density ?? "comfortable"}
              options={[
                { value: "comfortable", label: t("comfortable") },
                { value: "compact", label: t("compact") },
              ]}
              onChange={(density) => save({ density })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label>{t("dashboardLayout")}</Label>
            <Choice
              value={prefs.dashboard ?? "default"}
              options={[
                { value: "default", label: t("dashboardDefault") },
                { value: "queue_first", label: t("dashboardQueue") },
              ]}
              onChange={(dashboard) => save({ dashboard })}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("notifications")} icon={Bell}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="n-checkin">{t("notifyCheckin")}</Label>
            <Switch id="n-checkin" checked={prefs.notify_checkin !== false} onCheckedChange={(v) => save({ notify_checkin: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="n-rem">{t("notifyReminders")}</Label>
            <Switch id="n-rem" checked={prefs.notify_reminders !== false} onCheckedChange={(v) => save({ notify_reminders: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="n-sound">{t("soundAlerts")}</Label>
            <Switch id="n-sound" checked={prefs.sound_alerts === true} onCheckedChange={(v) => save({ sound_alerts: v })} />
          </div>
          <p className="text-xs text-muted-foreground">{t("notifyHint")}</p>
          {children}
        </div>
      </SectionCard>

      <SectionCard title={t("security")} icon={KeyRound}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
              const res = await changePassword(pw)
              if (res.ok) {
                setPw("")
                toast.success(t("passwordChanged"))
              } else toast.error(t("passwordInvalid"))
            })
          }}
        >
          <input type="email" autoComplete="username" value={email ?? ""} readOnly hidden />
          <div className="grid min-w-60 flex-1 gap-1.5">
            <Label htmlFor="new-pw">{t("newPassword")}</Label>
            <Input id="new-pw" type="password" autoComplete="new-password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <Button type="submit" disabled={pending || pw.length < 10}>
            {pending && <Loader2 className="animate-spin" />}
            {t("changePassword")}
          </Button>
        </form>
        <Link
          href="/settings/security"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition hover:bg-muted/50"
        >
          <span className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4 text-primary" />
            {t("sessionsLink")}
          </span>
          <ChevronRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
        </Link>
      </SectionCard>
    </div>
  )
}
