"use client"


import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Plus, Receipt, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/common/page"
import { useCan } from "@/components/app-context"
import { InvoiceStatusBadge, Money } from "@/components/accounting/money"
import { useActionError } from "@/hooks/use-action-error"
import { createPatientInvoice } from "@/lib/actions/accounting"
import { formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import type { InvoiceStatus } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface PatientInvoiceRow {
  id: string
  invoice_number: string
  issued_at: string
  status: InvoiceStatus
  total: number
  paid_patient: number
  paid_insurance: number
  balance_patient: number
  balance_insurance: number
  currency: string
  payment_type: string
}

/** Patient → Billing: financial history and balance (accounting.view). */
export function PatientBilling({ patientId, invoices }: { patientId: string; invoices: PatientInvoiceRow[] }) {
  const t = useTranslations("accounting")
  const locale = useLocale()
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const live = invoices.filter((i) => i.status !== "void")
  const c = invoices[0]?.currency ?? "JOD"
  const sum = (f: (i: PatientInvoiceRow) => number) => live.reduce((s, i) => s + Number(f(i)), 0)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [t("totalBilled"), sum((i) => i.total)],
          [t("paid"), sum((i) => i.paid_patient + i.paid_insurance)],
          [t("patientBalance"), sum((i) => i.balance_patient)],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label as string}</p>
            <p className="text-lg font-semibold">
              <Money value={value as number} currency={c} />
            </p>
          </div>
        ))}
      </div>
      <SectionCard
        title={t("invoices")}
        icon={Wallet}
        bodyClassName="p-0"
        actions={
          can(P.accountingCreate) ? (
            <Button
              size="xs"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await createPatientInvoice(patientId)
                  if (!res.ok) return showError(res.error)
                  router.push(`/accounting/invoices/${res.data.id}`)
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("newInvoice")}
            </Button>
          ) : null
        }
      >
        {invoices.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("noInvoices")}</p>
        ) : (
          <ul className="divide-y">
            {invoices.map((i) => (
              <li key={i.id}>
                <Link href={`/accounting/invoices/${i.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                  <Receipt className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs">{i.invoice_number}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(i.issued_at, locale)}</span>
                  <span className="ms-auto flex items-center gap-3">
                    <Money value={i.total} currency={i.currency} className="font-medium" />
                    {i.balance_patient + i.balance_insurance > 0 && (
                      <span className="text-xs text-destructive">
                        {t("remaining")}: <Money value={i.balance_patient + i.balance_insurance} currency={i.currency} />
                      </span>
                    )}
                    <InvoiceStatusBadge status={i.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
