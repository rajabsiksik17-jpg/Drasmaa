"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { History, Loader2, Package, Pencil, Plus, ShieldCheck, Tags } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { NativeSelect } from "@/components/common/native-select"
import { SectionCard } from "@/components/common/page"
import { useRefs } from "@/components/app-context"
import { Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { saveInsuranceCoverage, saveInsurancePrice, savePackageItems, saveService, servicePriceHistory, type PriceHistoryRow } from "@/lib/actions/pricing"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { Service, ServiceCategory } from "@/types/db"

const CATEGORIES: ServiceCategory[] = ["consultation", "followup", "ultrasound", "investigation", "report", "certificate", "procedure", "treatment", "package", "other"]
type Insurer = { id: string; name_en: string; name_ar: string; default_coverage_percent: number | null; active: boolean }

const emptyService = (): Partial<Service> => ({
  category: "consultation",
  name_en: "",
  name_ar: "",
  price_cash: 0,
  price_insurance: null,
  billable: true,
  insurance_eligible: true,
  default_duration_minutes: null,
  appointment_type: null,
  auto_trigger: null,
  notes: null,
  active: true,
})

/**
 * Services & price list. Changing a price only affects new charges: every
 * invoice line keeps the price it was charged with, and the price history
 * is kept.
 */
export function PricingManager({
  services,
  insurers,
  special,
  packageItems,
  currency,
  canManage,
}: {
  services: Service[]
  insurers: Insurer[]
  special: { service_id: string; insurance_company_id: string; price: number; coverage_percent: number | null }[]
  packageItems: { package_id: string; service_id: string; quantity: number }[]
  currency: string
  canManage: boolean
}) {
  const t = useTranslations("pricing")
  const locale = useLocale()
  const ar = locale === "ar"
  const [editing, setEditing] = useState<Partial<Service> | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const name = (s: { name_en: string; name_ar: string }) => (ar ? s.name_ar : s.name_en)
  const list = services.filter((s) => showInactive || s.active)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          {t("showInactive")}
        </label>
        {canManage && (
          <Button className="ms-auto" onClick={() => setEditing(emptyService())}>
            <Plus />
            {t("newService")}
          </Button>
        )}
      </div>

      <SectionCard title={t("priceList")} icon={Tags} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("service")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("category")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("cash")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("insurance")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("flags")}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((s) => (
                <tr key={s.id} className={cn("hover:bg-muted/40", !s.active && "opacity-50")}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{name(s)}</p>
                    <p className="text-xs text-muted-foreground">{ar ? s.name_en : s.name_ar}</p>
                  </td>
                  <td className="px-3 py-2">{t(`categories.${s.category}`)}</td>
                  <td className="px-3 py-2 text-end">{s.billable ? <Money value={s.price_cash} currency={currency} /> : <span className="text-muted-foreground">{t("free")}</span>}</td>
                  <td className="px-3 py-2 text-end">
                    {!s.billable ? "—" : s.insurance_eligible ? <Money value={s.price_insurance ?? s.price_cash} currency={currency} /> : <span className="text-xs text-muted-foreground">{t("notCovered")}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {[
                      s.appointment_type && t("forAppointment"),
                      s.auto_trigger && t(`triggers.${s.auto_trigger}`),
                      s.category === "package" && t("packageItems", { count: packageItems.filter((p) => p.package_id === s.id).length }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="px-1 py-1">
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditing(s)} aria-label={t("edit")}>
                      <Pencil />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <CoverageCard insurers={insurers} canManage={canManage} />

      {editing && (
        <ServiceEditor
          key={editing.id ?? "new"}
          service={editing}
          services={services}
          insurers={insurers}
          special={special.filter((x) => x.service_id === editing.id)}
          packageItems={packageItems.filter((x) => x.package_id === editing.id)}
          currency={currency}
          canManage={canManage}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function CoverageCard({ insurers, canManage }: { insurers: Insurer[]; canManage: boolean }) {
  const t = useTranslations("pricing")
  const locale = useLocale()
  const router = useRouter()
  const { showError } = useActionError()
  const [, start] = useTransition()
  return (
    <SectionCard title={t("coverage")} icon={ShieldCheck}>
      <p className="mb-3 text-sm text-muted-foreground">{t("coverageHint")}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {insurers
          .filter((i) => i.active)
          .map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{locale === "ar" ? i.name_ar : i.name_en}</span>
              <Input
                type="number"
                min={0}
                max={100}
                dir="ltr"
                defaultValue={i.default_coverage_percent ?? ""}
                disabled={!canManage}
                className="h-8 w-20"
                aria-label={t("coveragePercent")}
                onBlur={(e) =>
                  start(async () => {
                    const raw = e.target.value.trim()
                    const percent = raw === "" ? null : Math.max(0, Math.min(100, Number(raw)))
                    if (percent === i.default_coverage_percent) return
                    const res = await saveInsuranceCoverage({ insuranceCompanyId: i.id, percent })
                    if (!res.ok) return showError(res.error)
                    toast.success(t("saved"))
                    router.refresh()
                  })
                }
              />
              <span className="text-xs text-muted-foreground">%</span>
            </li>
          ))}
      </ul>
    </SectionCard>
  )
}

function ServiceEditor({
  service,
  services,
  insurers,
  special,
  packageItems,
  currency,
  canManage,
  onClose,
}: {
  service: Partial<Service>
  services: Service[]
  insurers: Insurer[]
  special: { insurance_company_id: string; price: number; coverage_percent: number | null }[]
  packageItems: { service_id: string; quantity: number }[]
  currency: string
  canManage: boolean
  onClose: () => void
}) {
  const t = useTranslations("pricing")
  const locale = useLocale()
  const refs = useRefs()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useTransition()
  const [v, setV] = useState({ ...emptyService(), ...service })
  const [items, setItems] = useState(packageItems)
  const [history, setHistory] = useState<PriceHistoryRow[] | null>(null)
  const ro = !canManage

  const save = () =>
    start(async () => {
      const res = await saveService({
        id: service.id,
        expectedVersion: service.version,
        category: v.category as ServiceCategory,
        name_en: v.name_en ?? "",
        name_ar: v.name_ar ?? "",
        price_cash: Number(v.price_cash) || 0,
        price_insurance: v.price_insurance === null || v.price_insurance === undefined || (v.price_insurance as unknown as string) === "" ? null : Number(v.price_insurance),
        billable: !!v.billable,
        insurance_eligible: !!v.insurance_eligible,
        default_duration_minutes: v.default_duration_minutes ? Number(v.default_duration_minutes) : null,
        appointment_type: v.appointment_type || null,
        auto_trigger: v.auto_trigger || null,
        notes: v.notes || null,
        active: !!v.active,
      })
      if (!res.ok) return showError(res.error)
      if (v.category === "package") {
        const r2 = await savePackageItems({ packageId: res.data.id, items: items.map((i) => ({ serviceId: i.service_id, quantity: i.quantity })) })
        if (!r2.ok) return showError(r2.error)
      }
      toast.success(t("saved"))
      router.refresh()
      onClose()
    })

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{service.id ? (locale === "ar" ? service.name_ar : service.name_en) : t("newService")}</SheetTitle>
          <SheetDescription>{t("historyNote")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="sv-ar">{t("nameAr")}</Label>
              <Input id="sv-ar" dir="rtl" value={v.name_ar ?? ""} disabled={ro} onChange={(e) => setV({ ...v, name_ar: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-en">{t("nameEn")}</Label>
              <Input id="sv-en" dir="ltr" value={v.name_en ?? ""} disabled={ro} onChange={(e) => setV({ ...v, name_en: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-cat">{t("category")}</Label>
              <NativeSelect id="sv-cat" value={v.category} disabled={ro} onChange={(e) => setV({ ...v, category: e.target.value as ServiceCategory })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`categories.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-dur">{t("duration")}</Label>
              <Input id="sv-dur" type="number" min={5} max={480} dir="ltr" value={v.default_duration_minutes ?? ""} disabled={ro} onChange={(e) => setV({ ...v, default_duration_minutes: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-2 sm:col-span-2">
              {t("billable")}
              <Switch checked={!!v.billable} disabled={ro} onCheckedChange={(c) => setV({ ...v, billable: c })} />
            </label>
            <div className="grid gap-1">
              <Label htmlFor="sv-cash">
                {t("cashPrice")} ({currency})
              </Label>
              <Input id="sv-cash" type="number" min={0} step="0.001" dir="ltr" value={v.price_cash ?? 0} disabled={ro || !v.billable} onChange={(e) => setV({ ...v, price_cash: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-ins">
                {t("insurancePrice")} ({currency})
              </Label>
              <Input
                id="sv-ins"
                type="number"
                min={0}
                step="0.001"
                dir="ltr"
                value={v.price_insurance ?? ""}
                placeholder={t("sameAsCash")}
                disabled={ro || !v.billable || !v.insurance_eligible}
                onChange={(e) => setV({ ...v, price_insurance: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center justify-between gap-2 sm:col-span-2">
              {t("insuranceEligible")}
              <Switch checked={!!v.insurance_eligible} disabled={ro} onCheckedChange={(c) => setV({ ...v, insurance_eligible: c })} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="sv-appt">{t("appointmentType")}</Label>
              <NativeSelect id="sv-appt" value={v.appointment_type ?? ""} disabled={ro} onChange={(e) => setV({ ...v, appointment_type: e.target.value || null })}>
                <option value="">—</option>
                {refs.activeOptions("appointment_type", v.appointment_type).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-trigger">{t("autoTrigger")}</Label>
              <NativeSelect id="sv-trigger" value={v.auto_trigger ?? ""} disabled={ro} onChange={(e) => setV({ ...v, auto_trigger: (e.target.value || null) as Service["auto_trigger"] })}>
                <option value="">—</option>
                {(["ultrasound", "medical_report", "medical_certificate"] as const).map((x) => (
                  <option key={x} value={x}>
                    {t(`triggers.${x}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("autoHint")}</p>

          {v.category === "package" && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 font-medium">
                <Package className="size-4" />
                {t("packageContents")}
              </p>
              {items.map((it, i) => (
                <div key={i} className="flex gap-2">
                  <NativeSelect value={it.service_id} disabled={ro} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, service_id: e.target.value } : x)))} className="flex-1">
                    {services
                      .filter((s) => s.id !== service.id && s.category !== "package")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {locale === "ar" ? s.name_ar : s.name_en}
                        </option>
                      ))}
                  </NativeSelect>
                  <Input type="number" min={1} max={50} dir="ltr" value={it.quantity} disabled={ro} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} className="w-20" />
                  <Button size="icon-sm" variant="ghost" disabled={ro} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t("remove")}>
                    ×
                  </Button>
                </div>
              ))}
              {!ro && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    const first = services.find((s) => s.id !== service.id && s.category !== "package")
                    if (first) setItems([...items, { service_id: first.id, quantity: 1 }])
                  }}
                >
                  <Plus />
                  {t("addComponent")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t("packageHint")}</p>
            </div>
          )}

          {service.id && v.billable && v.insurance_eligible && insurers.length > 0 && (
            <InsurancePrices serviceId={service.id} insurers={insurers} special={special} canManage={canManage} />
          )}

          <div className="grid gap-1">
            <Label htmlFor="sv-notes">{t("notes")}</Label>
            <Textarea id="sv-notes" value={v.notes ?? ""} disabled={ro} onChange={(e) => setV({ ...v, notes: e.target.value })} className="min-h-14" />
          </div>
          <label className="flex items-center gap-2">
            <Switch checked={!!v.active} disabled={ro} onCheckedChange={(c) => setV({ ...v, active: c })} />
            {t("active")}
          </label>

          {service.id && (
            <div>
              <Button
                size="xs"
                variant="ghost"
                onClick={async () => {
                  const res = await servicePriceHistory(service.id!)
                  if (res.ok) setHistory(res.data)
                }}
              >
                <History />
                {t("priceHistory")}
              </Button>
              {history && (
                <ul className="mt-2 divide-y rounded-lg border text-xs">
                  {history.map((h) => (
                    <li key={h.id} className="flex justify-between gap-2 px-3 py-1.5">
                      <span>{formatDateTime(h.changed_at, locale)}</span>
                      <span dir="ltr">
                        {Number(h.price_cash ?? 0).toFixed(3)} / {h.price_insurance != null ? Number(h.price_insurance).toFixed(3) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canManage && (
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button onClick={save} disabled={pending || !v.name_en?.trim() || !v.name_ar?.trim()}>
                {pending && <Loader2 className="animate-spin" />}
                {t("save")}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function InsurancePrices({
  serviceId,
  insurers,
  special,
  canManage,
}: {
  serviceId: string
  insurers: Insurer[]
  special: { insurance_company_id: string; price: number }[]
  canManage: boolean
}) {
  const t = useTranslations("pricing")
  const locale = useLocale()
  const { showError } = useActionError()
  const [, start] = useTransition()
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="flex items-center gap-1.5 font-medium">
        <ShieldCheck className="size-4" />
        {t("insuranceSpecific")}
      </p>
      {insurers
        .filter((i) => i.active)
        .map((i) => {
          const current = special.find((s) => s.insurance_company_id === i.id)
          return (
            <div key={i.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{locale === "ar" ? i.name_ar : i.name_en}</span>
              <Input
                type="number"
                min={0}
                step="0.001"
                dir="ltr"
                defaultValue={current?.price ?? ""}
                placeholder={t("default")}
                disabled={!canManage}
                className="h-8 w-28"
                onBlur={(e) =>
                  start(async () => {
                    const raw = e.target.value.trim()
                    const price = raw === "" ? null : Math.max(0, Number(raw))
                    if (price === (current?.price ?? null)) return
                    const res = await saveInsurancePrice({ serviceId, insuranceCompanyId: i.id, price, coveragePercent: null })
                    if (!res.ok) showError(res.error)
                  })
                }
              />
            </div>
          )
        })}
    </div>
  )
}
