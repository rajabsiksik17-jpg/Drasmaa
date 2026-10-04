"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Download, Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCan } from "@/components/app-context"
import { PatientPicker, type PickedPatient } from "@/components/patients/patient-picker"
import { RangeFilter } from "@/components/accounting/range-filter"
import { InvoiceStatusBadge, Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { createPatientInvoice } from "@/lib/actions/accounting"
import { formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { RangeKey } from "@/lib/accounting/ranges"
import type { InvoiceStatus } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface InvoiceListRow {
  id: string
  invoice_number: string
  issued_at: string
  status: InvoiceStatus
  payment_type: string
  total: number
  paid_patient: number
  paid_insurance: number
  balance_patient: number
  balance_insurance: number
  currency: string
  patient: { id: string; full_name: string; patient_code: string }
  doctor: { display_name_en: string; display_name_ar: string | null } | null
}

export function InvoicesList({ rows, range, status, q }: { rows: InvoiceListRow[]; range: { key: RangeKey; from: string; to: string }; status: string; q: string }) {
  const t = useTranslations("accounting")
  const locale = useLocale()
  const can = useCan()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { showError } = useActionError()
  const [search, setSearch] = useState(q)
  const [newOpen, setNewOpen] = useState(false)
  const [picked, setPicked] = useState<PickedPatient | null>(null)
  const [pending, start] = useSafeTransition()
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    router.push(`${pathname}?${next}`)
  }
  const totals = rows.reduce(
    (a, r) => (r.status === "void" ? a : { total: a.total + Number(r.total), paid: a.paid + Number(r.paid_patient) + Number(r.paid_insurance), balance: a.balance + Number(r.balance_patient) + Number(r.balance_insurance) }),
    { total: 0, paid: 0, balance: 0 },
  )
  const currency = rows[0]?.currency ?? "JOD"
  const csv = `/api/accounting/export?kind=invoices&from=${range.from}&to=${range.to}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {status !== "unpaid" && <RangeFilter range={range} />}
        <div className="ms-auto flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={csv}>
              <Download />
              CSV
            </a>
          </Button>
          {can(P.accountingCreate) && (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus />
              {t("newInvoice")}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "unpaid", "paid", "no_charge", "refunded", "void"] as const).map((s) => (
          <button
            key={s}
            onClick={() => set({ status: s === "all" ? null : s })}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", status === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {t(`filters.${s}`)}
          </button>
        ))}
        <form
          className="relative ms-auto w-full sm:w-64"
          onSubmit={(e) => {
            e.preventDefault()
            set({ q: search.trim() || null })
          }}
        >
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchInvoices")} className="ps-8" />
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("invoice")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("patient")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("doctor")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("total")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("paid")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("remaining")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("statusLabel")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/accounting/invoices/${r.id}`)}>
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/accounting/invoices/${r.id}`} className="hover:text-primary" onClick={(e) => e.stopPropagation()}>
                    {r.invoice_number}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.issued_at, locale)}</td>
                <td className="px-3 py-2">
                  {r.patient.full_name} <span className="text-xs text-muted-foreground">{r.patient.patient_code}</span>
                </td>
                <td className="px-3 py-2">{r.doctor ? (locale === "ar" ? r.doctor.display_name_ar || r.doctor.display_name_en : r.doctor.display_name_en) : "—"}</td>
                <td className="px-3 py-2 text-end">
                  <Money value={r.total} currency={r.currency} />
                </td>
                <td className="px-3 py-2 text-end">
                  <Money value={Number(r.paid_patient) + Number(r.paid_insurance)} currency={r.currency} />
                </td>
                <td className="px-3 py-2 text-end font-medium">
                  <Money value={Number(r.balance_patient) + Number(r.balance_insurance)} currency={r.currency} />
                </td>
                <td className="px-3 py-2">
                  <InvoiceStatusBadge status={r.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  {t("noInvoices")}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t bg-muted/30 font-medium">
              <tr>
                <td colSpan={4} className="px-3 py-2">
                  {t("totals", { count: rows.length })}
                </td>
                <td className="px-3 py-2 text-end">
                  <Money value={totals.total} currency={currency} />
                </td>
                <td className="px-3 py-2 text-end">
                  <Money value={totals.paid} currency={currency} />
                </td>
                <td className="px-3 py-2 text-end">
                  <Money value={totals.balance} currency={currency} />
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newInvoice")}</DialogTitle>
            <DialogDescription>{t("newInvoiceHint")}</DialogDescription>
          </DialogHeader>
          <PatientPicker value={picked} onChange={setPicked} />
          <Button
            disabled={!picked || pending}
            onClick={() =>
              start(async () => {
                if (!picked) return
                const res = await createPatientInvoice(picked.id)
                if (!res.ok) return showError(res.error)
                router.push(`/accounting/invoices/${res.data.id}`)
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            {t("create")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
