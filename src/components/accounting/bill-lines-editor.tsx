"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, MessageSquarePlus, Minus, PencilLine, Plus, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/common/native-select"
import { Field, useFieldErrors } from "@/components/forms/field"
import { useCan, useRefs } from "@/components/app-context"
import { Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { addCustomInvoiceLine, addInvoiceService, updateInvoiceLine } from "@/lib/actions/accounting"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { InvoiceLine, PaymentType } from "@/types/db"

export type EditableLine = Pick<InvoiceLine, "id" | "service_id" | "description_en" | "description_ar" | "quantity" | "unit_price" | "line_total" | "package_line_id" | "default_price" | "discount_amount" | "notes"> & {
  source?: string
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Services actually consumed on this visit / invoice. The catalog gives the
 * default; the line keeps the real price for THIS visit (the catalog never
 * changes here), a discount, quantity and notes. Custom services live only
 * on this invoice. Every change is permission-checked and audited server-side.
 */
export function BillLinesEditor({
  invoiceId,
  currency,
  paymentType,
  lines,
  editable,
  withReason,
}: {
  invoiceId: string
  currency: string
  paymentType: PaymentType
  lines: EditableLine[]
  editable: boolean
  /** Paid invoices: ask for a correction reason first (checkout). */
  withReason?: (fn: (reason?: string) => void) => void
}) {
  const t = useTranslations("billing")
  const ta = useTranslations("accounting")
  const locale = useLocale()
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [serviceId, setServiceId] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  const canPrice = editable && can(P.billingPriceOverride, P.accountingEdit, P.pricingManage)
  const canDiscount = editable && can(P.accountingDiscount)
  const name = (l: { description_en: string; description_ar: string }) => (locale === "ar" ? l.description_ar : l.description_en)
  const top = lines.filter((l) => !l.package_line_id)
  const components = (id: string) => lines.filter((l) => l.package_line_id === id)
  const services = refs.services.filter((s) => s.active && s.auto_trigger !== "registration")
  const priceOf = (s: (typeof services)[number]) => Number(paymentType !== "cash" && s.insurance_eligible ? (s.price_insurance ?? s.price_cash) : s.price_cash)
  const run = (fn: (reason?: string) => Promise<{ ok: boolean; error?: Parameters<typeof showError>[0] }>) => {
    const go = (reason?: string) =>
      start(async () => {
        const res = await fn(reason)
        if (!res.ok) return showError(res.error!)
        router.refresh()
      })
    if (withReason) withReason(go)
    else go()
  }
  const change = (line: EditableLine, patch: { quantity?: number; unitPrice?: number; discount?: number; notes?: string | null; remove?: boolean }) =>
    run((reason) => updateInvoiceLine({ lineId: line.id, ...patch, reason: reason ?? null }))
  const addCatalog = () =>
    serviceId &&
    run(async (reason) => {
      const res = await addInvoiceService({ invoiceId, serviceId, quantity: 1, reason: reason ?? null })
      if (res.ok) {
        setServiceId("")
        toast.success(ta("serviceAdded"))
      }
      return res
    })

  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border">
        {top.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{ta("noLines")}</li>}
        {top.map((l) => (
          <LineRow
            key={l.id}
            line={l}
            name={name(l)}
            components={components(l.id).map((c) => `${name(c)} × ${c.quantity}`)}
            currency={currency}
            editable={editable && l.source !== "registration"}
            canPrice={canPrice}
            canDiscount={canDiscount}
            pending={pending}
            onChange={(patch) => change(l, patch)}
          />
        ))}
      </ul>

      {editable && (can(P.accountingCreate) || can(P.billingCharge)) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label={ta("addService")} className="min-w-0 flex-1">
            <option value="">{ta("chooseService")}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {locale === "ar" ? s.name_ar : s.name_en} — {s.billable ? priceOf(s).toFixed(3) : ta("free")}
              </option>
            ))}
          </NativeSelect>
          <div className="flex gap-2">
            <Button onClick={addCatalog} disabled={!serviceId || pending} className="flex-1 sm:flex-none">
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}
              {ta("addService")}
            </Button>
            {canPrice && (
              <Button variant="outline" onClick={() => setCustomOpen((o) => !o)} aria-expanded={customOpen} className="flex-1 sm:flex-none">
                <Sparkles />
                {t("addCustom")}
              </Button>
            )}
          </div>
        </div>
      )}
      {customOpen && canPrice && (
        <CustomServiceForm invoiceId={invoiceId} currency={currency} canDiscount={canDiscount} withReason={withReason} onDone={() => setCustomOpen(false)} />
      )}
    </div>
  )
}

function LineRow({
  line: l,
  name,
  components,
  currency,
  editable,
  canPrice,
  canDiscount,
  pending,
  onChange,
}: {
  line: EditableLine
  name: string
  components: string[]
  currency: string
  editable: boolean
  canPrice: boolean
  canDiscount: boolean
  pending: boolean
  onChange: (patch: { quantity?: number; unitPrice?: number; discount?: number; notes?: string | null; remove?: boolean }) => void
}) {
  const t = useTranslations("billing")
  const ta = useTranslations("accounting")
  const [noteOpen, setNoteOpen] = useState(false)
  const custom = !l.service_id
  const changed = l.default_price != null && Number(l.default_price) !== Number(l.unit_price)
  const discount = Number(l.discount_amount ?? 0)
  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words" dir="auto">
            {name}
            {custom && <span className="ms-2 rounded bg-violet-500/12 px-1.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">{t("custom")}</span>}
            {l.source && l.source !== "manual" && <span className="ms-2 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{ta(`sources.${l.source}`)}</span>}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums" dir="ltr">
            {l.quantity} × {Number(l.unit_price).toFixed(3)}
            {discount > 0 && ` − ${discount.toFixed(3)}`}
            {changed && (
              <span className="ms-2 text-amber-700 dark:text-amber-300">
                ({t("defaultPrice")} {Number(l.default_price).toFixed(3)})
              </span>
            )}
          </p>
          {components.length > 0 && <p className="text-xs text-muted-foreground">{components.join(" · ")}</p>}
          {l.notes && !noteOpen && <p className="mt-0.5 text-xs whitespace-pre-line text-muted-foreground" dir="auto">{l.notes}</p>}
        </div>
        <Money value={l.line_total} currency={currency} className="shrink-0 font-semibold" />
      </div>

      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-center rounded-lg border">
            <Button size="icon-sm" variant="ghost" aria-label={ta("decrease")} disabled={pending || l.quantity <= 1} onClick={() => onChange({ quantity: l.quantity - 1 })}>
              <Minus />
            </Button>
            <span className="w-7 text-center tabular-nums" aria-label={ta("qty")}>
              {l.quantity}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label={ta("increase")} disabled={pending || l.quantity >= 100} onClick={() => onChange({ quantity: l.quantity + 1 })}>
              <Plus />
            </Button>
          </div>
          {canPrice && (
            <label className="grid gap-0.5 text-[11px] text-muted-foreground">
              {t("visitPrice")}
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.001"
                dir="ltr"
                defaultValue={Number(l.unit_price)}
                key={`p-${l.unit_price}`}
                className="h-8 w-28"
                onBlur={(e) => {
                  const v = r3(Number(e.target.value))
                  if (e.target.value === "" || !Number.isFinite(v) || v < 0) {
                    e.target.value = String(l.unit_price)
                    return toast.error(t("priceInvalid"))
                  }
                  if (v !== Number(l.unit_price)) onChange({ unitPrice: v })
                }}
              />
            </label>
          )}
          {canDiscount && (
            <label className="grid gap-0.5 text-[11px] text-muted-foreground">
              {ta("discount")}
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.001"
                dir="ltr"
                defaultValue={discount}
                key={`d-${discount}`}
                className="h-8 w-24"
                onBlur={(e) => {
                  const v = r3(Number(e.target.value || 0))
                  const gross = r3(Number(l.unit_price) * l.quantity)
                  if (!Number.isFinite(v) || v < 0 || v > gross) {
                    e.target.value = String(discount)
                    return toast.error(t("discountInvalid", { max: gross.toFixed(3) }))
                  }
                  if (v !== discount) onChange({ discount: v })
                }}
              />
            </label>
          )}
          <Button size="sm" variant="ghost" onClick={() => setNoteOpen((o) => !o)} aria-expanded={noteOpen}>
            {l.notes ? <PencilLine /> : <MessageSquarePlus />}
            {t("note")}
          </Button>
          <Button size="icon-sm" variant="ghost" className="ms-auto text-destructive" aria-label={ta("remove")} disabled={pending} onClick={() => onChange({ remove: true })}>
            <Trash2 />
          </Button>
        </div>
      )}
      {editable && noteOpen && (
        <Textarea
          defaultValue={l.notes ?? ""}
          rows={2}
          dir="auto"
          autoFocus
          placeholder={t("notePlaceholder")}
          onBlur={(e) => {
            const v = e.target.value.trim()
            setNoteOpen(false)
            if (v !== (l.notes ?? "")) onChange({ notes: v || null })
          }}
        />
      )}
    </li>
  )
}

function CustomServiceForm({
  invoiceId,
  currency,
  canDiscount,
  withReason,
  onDone,
}: {
  invoiceId: string
  currency: string
  canDiscount: boolean
  withReason?: (fn: (reason?: string) => void) => void
  onDone: () => void
}) {
  const t = useTranslations("billing")
  const tc = useTranslations("common")
  const router = useRouter()
  const { showError } = useActionError()
  const { errors, validate, fromAction, clear, t: tv } = useFieldErrors()
  const [pending, start] = useSafeTransition()
  const [v, setV] = useState({ name: "", price: "", quantity: "1", discount: "0", notes: "" })
  const price = Number(v.price)
  const qty = Number(v.quantity)
  const disc = Number(v.discount || 0)
  const set = (k: keyof typeof v, id: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV({ ...v, [k]: e.target.value })
    clear(id)
  }

  const submit = () => {
    const ok = validate({
      "cs-name": () => !v.name.trim() && tv("serviceNameRequired"),
      "cs-price": () => (v.price === "" ? tv("priceRequired") : !Number.isFinite(price) || price < 0 ? tv("priceMin") : null),
      "cs-qty": () => (!Number.isInteger(qty) || qty < 1 || qty > 100 ? tv("quantityRange") : null),
      "cs-discount": () => (!Number.isFinite(disc) || disc < 0 ? tv("discountMin") : Number.isFinite(price) && disc > price * qty ? tv("discountTooLarge") : null),
    })
    if (!ok) return
    const go = (reason?: string) =>
      start(async () => {
        const res = await addCustomInvoiceLine({ invoiceId, name: v.name.trim(), price, quantity: qty, discount: disc, notes: v.notes.trim() || null, reason: reason ?? null })
        if (!res.ok) {
          if (!fromAction(res.error, { name: "cs-name", price: "cs-price", quantity: "cs-qty", discount: "cs-discount" })) showError(res.error)
          return
        }
        toast.success(t("customAdded"))
        router.refresh()
        onDone()
      })
    if (withReason) withReason(go)
    else go()
  }

  return (
    <div className="space-y-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3" onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && submit()}>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-4 text-violet-600" />
        {t("customTitle")}
      </p>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_5rem_1fr]">
        <Field id="cs-name" label={t("serviceName")} required error={errors["cs-name"]}>
          <Input value={v.name} onChange={set("name", "cs-name")} dir="auto" placeholder={t("serviceNamePlaceholder")} />
        </Field>
        <Field id="cs-price" label={`${t("price")} (${currency})`} required error={errors["cs-price"]}>
          <Input value={v.price} onChange={set("price", "cs-price")} type="number" inputMode="decimal" min={0} step="0.001" dir="ltr" />
        </Field>
        <Field id="cs-qty" label={t("quantity")} error={errors["cs-qty"]}>
          <Input value={v.quantity} onChange={set("quantity", "cs-qty")} type="number" inputMode="numeric" min={1} max={100} dir="ltr" />
        </Field>
        {canDiscount ? (
          <Field id="cs-discount" label={t("discount")} error={errors["cs-discount"]}>
            <Input value={v.discount} onChange={set("discount", "cs-discount")} type="number" inputMode="decimal" min={0} step="0.001" dir="ltr" />
          </Field>
        ) : (
          <span />
        )}
        <Field id="cs-notes" label={t("note")} className="sm:col-span-4">
          <Textarea value={v.notes} onChange={set("notes", "cs-notes")} rows={2} dir="auto" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {t("finalAmount")}: <Money value={Math.max(0, (Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) ? qty : 0) - (Number.isFinite(disc) ? disc : 0))} currency={currency} className="font-semibold" />
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            {tc("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("addCustomConfirm")}
          </Button>
        </div>
      </div>
      <p className={cn("text-xs text-muted-foreground")}>{t("customHint")}</p>
    </div>
  )
}
