"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { ArrowRightLeft, CalendarClock, CreditCard, Loader2, Percent, Save, Tags } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { SectionCard } from "@/components/common/page"
import { useCan } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { saveBillingSettings, saveRoleDiscountLimit } from "@/lib/actions/staff"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { ClinicSettings, Role } from "@/types/db"

const METHODS = ["cash", "card", "transfer", "other"] as const
const WEEK = [6, 0, 1, 2, 3, 4, 5]

type Settings = Pick<ClinicSettings, "collect_payment_before_consultation" | "enforce_working_hours" | "working_days" | "payment_methods" | "version" | "working_hours_start" | "working_hours_end">

/** Settings → Accounting → Payment workflow (and related billing rules). Every switch is stored and enforced by the database. */
export function BillingSettings({
  settings,
  roles,
  registration,
}: {
  settings: Settings
  roles: Pick<Role, "id" | "code" | "name_en" | "name_ar" | "max_discount_percent" | "active">[]
  registration: { name: string; price: number; active: boolean } | null
}) {
  const t = useTranslations("billingSettings")
  const tw = useTranslations("weekdays")
  const ta = useTranslations("accounting")
  const locale = useLocale()
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [v, setV] = useState({
    collect_payment_before_consultation: settings.collect_payment_before_consultation,
    enforce_working_hours: settings.enforce_working_hours,
    working_days: settings.working_days,
    payment_methods: settings.payment_methods,
  })
  const [limits, setLimits] = useState(() => Object.fromEntries(roles.map((r) => [r.id, r.max_discount_percent == null ? "" : String(r.max_discount_percent)])))
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])

  const save = () =>
    start(async () => {
      const res = await saveBillingSettings(v, settings.version)
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  const saveLimit = (roleId: string) =>
    start(async () => {
      const raw = limits[roleId]
      const res = await saveRoleDiscountLimit(roleId, raw === "" ? null : Number(raw))
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  return (
    <div className="space-y-5">
      <SectionCard title={t("workflowTitle")} icon={ArrowRightLeft}>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="font-medium">{t("collectBefore")}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{v.collect_payment_before_consultation ? t("collectBeforeOn") : t("collectBeforeOff")}</span>
          </span>
          <Switch checked={v.collect_payment_before_consultation} onCheckedChange={(c) => setV({ ...v, collect_payment_before_consultation: c })} />
        </label>
        <ol className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
          {(v.collect_payment_before_consultation ? ["registration", "billing", "payment", "queue", "doctor", "checkout"] : ["registration", "queue", "doctor", "bill", "payment", "checkout"]).map((step, i, arr) => (
            <li key={step} className="flex items-center gap-1.5">
              <span className={cn("rounded-full border px-2 py-0.5", step === "payment" && "border-primary bg-primary/10 font-medium text-primary")}>{t(`steps.${step}`)}</span>
              {i < arr.length - 1 && <span className="text-muted-foreground rtl:-scale-x-100">→</span>}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">{t("workflowNote")}</p>
      </SectionCard>

      <SectionCard title={t("registrationTitle")} icon={Tags}>
        <p className="text-sm">
          {registration ? (registration.active ? t("registrationActive", { name: registration.name, price: registration.price.toFixed(3) }) : t("registrationInactive")) : t("registrationMissing")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("registrationHint")}</p>
        {can(P.pricingManage) && (
          <Button size="sm" variant="outline" className="mt-3" asChild>
            <Link href="/admin/pricing">{t("openPricing")}</Link>
          </Button>
        )}
      </SectionCard>

      <SectionCard title={t("hoursTitle")} icon={CalendarClock}>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="font-medium">{t("enforceHours")}</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {t("enforceHoursHint", { start: settings.working_hours_start.slice(0, 5), end: settings.working_hours_end.slice(0, 5) })}
            </span>
          </span>
          <Switch checked={v.enforce_working_hours} onCheckedChange={(c) => setV({ ...v, enforce_working_hours: c })} />
        </label>
        <p className="mt-4 mb-2 text-sm font-medium">{t("workingDays")}</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEK.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={v.working_days.includes(d)}
              onClick={() => setV({ ...v, working_days: toggle(v.working_days, d) })}
              className={cn("min-h-9 rounded-full border px-3 text-sm", v.working_days.includes(d) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {tw(String(d))}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("hoursNote")}</p>
      </SectionCard>

      <SectionCard title={t("methodsTitle")} icon={CreditCard}>
        <div className="flex flex-wrap gap-1.5">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={v.payment_methods.includes(m)}
              onClick={() => setV({ ...v, payment_methods: toggle(v.payment_methods, m) })}
              className={cn("min-h-9 rounded-full border px-3 text-sm", v.payment_methods.includes(m) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {ta(`methods.${m}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("methodsHint")}</p>
      </SectionCard>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending || v.payment_methods.length === 0}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          {t("save")}
        </Button>
      </div>

      {can(P.rolesManage) && (
        <SectionCard title={t("discountTitle")} icon={Percent}>
          <p className="mb-3 text-xs text-muted-foreground">{t("discountHint")}</p>
          <ul className="divide-y rounded-lg border">
            {roles
              .filter((r) => r.active)
              .map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                  <span className="min-w-32 flex-1 font-medium">{locale === "ar" ? r.name_ar : r.name_en}</span>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      dir="ltr"
                      className="h-8 w-24"
                      placeholder={t("unlimited")}
                      value={limits[r.id] ?? ""}
                      onChange={(e) => setLimits({ ...limits, [r.id]: e.target.value })}
                      aria-label={t("maxDiscount")}
                    />
                    <span className="text-muted-foreground">%</span>
                    <Button size="sm" variant="secondary" onClick={() => saveLimit(r.id)} disabled={pending}>
                      <Save />
                      {t("save")}
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("discountPermissionNote")}</p>
        </SectionCard>
      )}
    </div>
  )
}
