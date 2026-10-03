"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, CalendarDays, Lock, LockOpen, Loader2, MinusCircle, Plus, Scale, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DateInput } from "@/components/common/date-input"
import { SectionCard } from "@/components/common/page"
import { useCan } from "@/components/app-context"
import { Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { addCashExpense, addRegisterAdjustment, closeRegister, openRegister } from "@/lib/actions/accounting"
import { formatDate, formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { CashRegister } from "@/types/db"

export interface RegisterData {
  date: string
  today: string
  register: CashRegister | null
  payments: { id: string; kind: "payment" | "refund"; amount: number; method: string; receipt_number: string; received_at: string; invoice_id: string }[]
  expenses: { id: string; amount: number; description: string; created_at: string; created_by: string | null }[]
  adjustments: { id: string; amount: number; reason: string; created_at: string; created_by: string | null }[]
  history: CashRegister[]
  suggestedOpening: number
  currency: string
  people: Record<string, string>
}

export function CashRegisterView({ data }: { data: RegisterData }) {
  const t = useTranslations("accounting.register")
  const ta = useTranslations("accounting")
  const locale = useLocale()
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useTransition()
  const c = data.currency
  const reg = data.register
  const closed = reg?.status === "closed"
  const cash = data.payments.filter((p) => p.method === "cash")
  const received = cash.filter((p) => p.kind === "payment").reduce((s, p) => s + Number(p.amount), 0)
  const refunds = cash.filter((p) => p.kind === "refund").reduce((s, p) => s + Number(p.amount), 0)
  const expenses = data.expenses.reduce((s, e) => s + Number(e.amount), 0)
  const opening = Number(reg?.opening_balance ?? 0)
  const expected = closed ? Number(reg?.expected_cash) : opening + received - refunds - expenses
  const adjust = data.adjustments.reduce((s, a) => s + Number(a.amount), 0)

  const [openingInput, setOpeningInput] = useState(String(data.suggestedOpening))
  const [exp, setExp] = useState({ amount: "", description: "" })
  const [counted, setCounted] = useState("")
  const [notes, setNotes] = useState("")
  const [adj, setAdj] = useState({ amount: "", reason: "" })
  const run = (fn: () => Promise<{ ok: boolean; error?: Parameters<typeof showError>[0] }>, done: string) =>
    start(async () => {
      const res = await fn()
      if (!res.ok) return showError(res.error!)
      toast.success(done)
      router.refresh()
    })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarDays className="size-4 text-muted-foreground" />
        <DateInput value={data.date} onChange={(v) => v && router.push(`/accounting/register?date=${v}`)} max={data.today} className="w-40" aria-label={t("date")} />
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", closed ? "bg-muted text-muted-foreground" : reg ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
          {closed ? t("closed") : reg ? t("open") : t("notOpened")}
        </span>
      </div>

      {!reg && can(P.accountingCloseDay) && (
        <SectionCard title={t("openTitle")} icon={LockOpen}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="rg-open">{t("openingBalance")}</Label>
              <Input id="rg-open" type="number" min={0} step="0.001" dir="ltr" value={openingInput} onChange={(e) => setOpeningInput(e.target.value)} className="w-40" />
            </div>
            <Button onClick={() => run(() => openRegister({ date: data.date, openingBalance: Number(openingInput) || 0 }), t("opened"))} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {t("openRegister")}
            </Button>
          </div>
        </SectionCard>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [t("openingBalance"), opening, Wallet],
          [t("cashReceived"), received, Banknote],
          [t("cashRefunds"), refunds, MinusCircle],
          [t("cashExpenses"), expenses, MinusCircle],
          [t("expectedCash"), expected, Scale],
        ].map(([label, value, Icon]) => {
          const I = Icon as typeof Wallet
          return (
            <div key={label as string} className="flex items-center gap-3 rounded-xl border bg-card p-4">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <I className="size-4" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{label as string}</p>
                <p className="font-semibold">
                  <Money value={value as number} currency={c} />
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {closed && reg && (
        <SectionCard title={t("closedTitle")} icon={Lock}>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t("actualCash")}</dt>
              <dd className="font-semibold">
                <Money value={Number(reg.actual_cash)} currency={c} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("difference")}</dt>
              <dd className={cn("font-semibold", Number(reg.difference) !== 0 && "text-destructive")}>
                <Money value={Number(reg.difference)} currency={c} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("closedBy")}</dt>
              <dd>
                {reg.closed_by ? data.people[reg.closed_by] : "—"} · {reg.closed_at ? formatDateTime(reg.closed_at, locale) : ""}
              </dd>
            </div>
            {adjust !== 0 && (
              <div>
                <dt className="text-xs text-muted-foreground">{t("adjustments")}</dt>
                <dd>
                  <Money value={adjust} currency={c} />
                </dd>
              </div>
            )}
          </dl>
          {reg.notes && <p className="mt-2 text-sm text-muted-foreground">{reg.notes}</p>}
          {data.adjustments.length > 0 && (
            <ul className="mt-3 divide-y rounded-lg border text-sm">
              {data.adjustments.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    {a.reason}
                    <span className="ms-2 text-xs text-muted-foreground">
                      {a.created_by ? data.people[a.created_by] : ""} · {formatDateTime(a.created_at, locale)}
                    </span>
                  </span>
                  <Money value={a.amount} currency={c} />
                </li>
              ))}
            </ul>
          )}
          {can(P.accountingEdit) && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
              <div className="grid gap-1">
                <Label htmlFor="rg-adj">{t("adjustmentAmount")}</Label>
                <Input id="rg-adj" type="number" step="0.001" dir="ltr" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} className="w-36" />
              </div>
              <Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder={t("reason")} className="min-w-48 flex-1" />
              <Button
                variant="outline"
                disabled={pending || !Number(adj.amount) || adj.reason.trim().length < 3}
                onClick={() => run(() => addRegisterAdjustment({ registerId: reg.id, amount: Number(adj.amount), reason: adj.reason }), t("adjusted"))}
              >
                {t("addAdjustment")}
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title={t("cashMovements")} icon={Banknote} bodyClassName="p-0">
          {cash.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("noMovements")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {cash.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <a href={`/accounting/invoices/${p.invoice_id}`} className="font-mono text-xs hover:text-primary">
                    {p.receipt_number}
                  </a>
                  <span className="text-xs text-muted-foreground">{formatDateTime(p.received_at, locale)}</span>
                  <span className={p.kind === "refund" ? "text-destructive" : ""}>
                    {p.kind === "refund" ? "−" : "+"}
                    <Money value={p.amount} currency={c} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={t("expenses")} icon={MinusCircle} bodyClassName="p-0">
          <ul className="divide-y text-sm">
            {data.expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>
                  {e.description}
                  <span className="ms-2 text-xs text-muted-foreground">{e.created_by ? data.people[e.created_by] : ""}</span>
                </span>
                <Money value={e.amount} currency={c} />
              </li>
            ))}
          </ul>
          {!closed && can(P.accountingCreate) && (
            <div className="flex flex-wrap gap-2 border-t p-3">
              <Input type="number" min={0} step="0.001" dir="ltr" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder={ta("amount")} className="w-28" />
              <Input value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} placeholder={t("expenseDescription")} className="min-w-40 flex-1" />
              <Button
                variant="outline"
                disabled={pending || !(Number(exp.amount) > 0) || exp.description.trim().length < 2}
                onClick={() =>
                  run(async () => {
                    const r = await addCashExpense({ date: data.date, amount: Number(exp.amount), description: exp.description })
                    if (r.ok) setExp({ amount: "", description: "" })
                    return r
                  }, t("expenseAdded"))
                }
              >
                <Plus />
                {t("addExpense")}
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      {reg && !closed && can(P.accountingCloseDay) && (
        <SectionCard title={t("closeTitle")} icon={Lock}>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="rg-count">{t("actualCash")}</Label>
              <Input id="rg-count" type="number" min={0} step="0.001" dir="ltr" value={counted} onChange={(e) => setCounted(e.target.value)} />
            </div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notes")} className="min-h-10" />
            <Button disabled={pending || counted === ""} onClick={() => run(() => closeRegister({ id: reg.id, expectedVersion: reg.version, actualCash: Number(counted), notes }), t("closedToast"))}>
              <Lock />
              {t("closeRegister")}
            </Button>
          </div>
          {counted !== "" && (
            <p className={cn("mt-2 text-sm", Number(counted) - expected !== 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300")}>
              {t("differencePreview")}: <Money value={Number(counted) - expected} currency={c} />
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("closeHint")}</p>
        </SectionCard>
      )}

      <SectionCard title={t("history")} icon={CalendarDays} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("openingBalance")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("expectedCash")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("actualCash")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("difference")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.history.map((h) => (
                <tr key={h.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/accounting/register?date=${h.register_date}`)}>
                  <td className="px-3 py-2">{formatDate(h.register_date)}</td>
                  <td className="px-3 py-2 text-end">
                    <Money value={Number(h.opening_balance)} currency={c} />
                  </td>
                  <td className="px-3 py-2 text-end">{h.expected_cash != null ? <Money value={Number(h.expected_cash)} currency={c} /> : "—"}</td>
                  <td className="px-3 py-2 text-end">{h.actual_cash != null ? <Money value={Number(h.actual_cash)} currency={c} /> : "—"}</td>
                  <td className={cn("px-3 py-2 text-end", Number(h.difference ?? 0) !== 0 && "text-destructive")}>
                    {h.difference != null ? <Money value={Number(h.difference)} currency={c} /> : "—"}
                  </td>
                  <td className="px-3 py-2">{h.status === "closed" ? t("closed") : t("open")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}
