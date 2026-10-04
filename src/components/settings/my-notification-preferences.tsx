"use client"

import { useOptimistic, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, Lock, Mail, MonitorSmartphone } from "lucide-react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { useActionError } from "@/hooks/use-action-error"
import { saveMyNotificationPreference } from "@/lib/actions/security"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface MyEventPref {
  code: string
  category: string
  name_en: string
  name_ar: string
  is_critical: boolean
  emailAvailable: boolean
  in_app: boolean
  email: boolean
}

/** Personal mute switches. Critical security events are always delivered. */
export function MyNotificationPreferences({ rows }: { rows: MyEventPref[] }) {
  const t = useTranslations("settings")
  const tn = useTranslations("notifications")
  const locale = useLocale()
  const { message } = useActionError()
  const [open, setOpen] = useState(false)
  const [, start] = useSafeTransition()
  const [state, update] = useOptimistic(rows, (s, patch: Pick<MyEventPref, "code" | "in_app" | "email">) =>
    s.map((r) => (r.code === patch.code ? { ...r, ...patch } : r)),
  )
  const change = (r: MyEventPref, patch: Partial<Pick<MyEventPref, "in_app" | "email">>) =>
    start(async () => {
      const next = { code: r.code, in_app: patch.in_app ?? r.in_app, email: patch.email ?? r.email }
      update(next)
      const res = await saveMyNotificationPreference({ event_code: r.code, in_app: next.in_app, email: next.email })
      if (!res.ok) toast.error(message(res.error))
    })

  return (
    <div className="border-t pt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-sm font-medium">
        {t("perEvent")}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-2 divide-y rounded-lg border">
          {state.map((r) => (
            <li key={r.code} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm">
                {locale === "ar" ? r.name_ar : r.name_en}
                <span className="ms-2 text-[11px] text-muted-foreground">{tn(`category.${r.category}`)}</span>
                {r.is_critical && (
                  <span className="ms-2 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                    <Lock className="size-3" />
                    {t("alwaysOn")}
                  </span>
                )}
              </span>
              <label className="flex items-center gap-1.5 text-xs">
                <MonitorSmartphone className="size-3.5 text-muted-foreground" />
                <Switch checked={r.in_app} disabled={r.is_critical} onCheckedChange={(v) => change(r, { in_app: v })} aria-label={t("inApp")} />
              </label>
              {r.emailAvailable && (
                <label className="flex items-center gap-1.5 text-xs">
                  <Mail className="size-3.5 text-muted-foreground" />
                  <Switch checked={r.email} disabled={r.is_critical} onCheckedChange={(v) => change(r, { email: v })} aria-label={t("emailChannel")} />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
