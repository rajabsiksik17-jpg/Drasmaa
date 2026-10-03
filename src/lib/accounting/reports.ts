import "server-only"
import { createClient } from "@/lib/supabase/server"
import { clinicDayRange } from "@/lib/dates"

import { type AccountingReport } from "./report-kinds"

export { ACCOUNTING_REPORTS, isAccountingReport, type AccountingReport } from "./report-kinds"

export interface ReportTable {
  columns: string[]
  /** Column keys that hold money (right aligned / formatted). */
  money: number[]
  rows: (string | number)[][]
}

type Supa = Awaited<ReturnType<typeof createClient>>

/**
 * One data source for every financial report: the same rows feed the
 * print/PDF view and the CSV export. RLS (accounting.view) applies.
 */
export async function buildAccountingReport(kind: AccountingReport, from: string, to: string, locale: "ar" | "en"): Promise<ReportTable> {
  const supabase = await createClient()
  const start = clinicDayRange(from).start
  const end = clinicDayRange(to).end
  const ar = locale === "ar"
  const summary = async () => {
    const { data, error } = await supabase.rpc("accounting_summary", { p_from: from, p_to: to })
    if (error) throw error
    return data as Record<string, never>
  }
  const invoices = (s: Supa) =>
    s
      .from("invoices")
      .select("invoice_number, issued_at, status, payment_type, subtotal, discount_amount, discount_reason, total, insurance_amount, paid_patient, paid_insurance, balance_patient, balance_insurance, insurance_claim_ref, patient:patients(full_name, patient_code), company:insurance_companies(name_en, name_ar)")
      .neq("status", "void")
  type Inv = {
    invoice_number: string
    issued_at: string
    status: string
    payment_type: string
    subtotal: number
    discount_amount: number
    discount_reason: string | null
    total: number
    insurance_amount: number
    paid_patient: number
    paid_insurance: number
    balance_patient: number
    balance_insurance: number
    insurance_claim_ref: string | null
    patient: { full_name: string; patient_code: string } | null
    company: { name_en: string; name_ar: string } | null
  }
  const payments = () =>
    supabase
      .from("payments")
      .select("receipt_number, kind, payer, method, amount, reason, received_at, invoice:invoices(invoice_number), patient:patients(full_name)")
      .gte("received_at", start)
      .lt("received_at", end)
      .order("received_at")
  type Pay = { receipt_number: string; kind: string; payer: string; method: string; amount: number; reason: string | null; received_at: string; invoice: { invoice_number: string } | null; patient: { full_name: string } | null }
  const day = (iso: string) => iso.slice(0, 10)

  switch (kind) {
    case "daily_revenue": {
      const s = await summary()
      const daily = (s.daily ?? []) as { day: string; revenue: number; collected: number }[]
      return { columns: ["date", "revenue", "collected"], money: [1, 2], rows: daily.map((d) => [d.day, Number(d.revenue), Number(d.collected)]) }
    }
    case "revenue_by_doctor": {
      const s = await summary()
      const list = (s.by_doctor ?? []) as { name_en: string | null; name_ar: string | null; amount: number; count: number }[]
      return { columns: ["doctor", "invoices", "revenue"], money: [2], rows: list.map((d) => [(ar ? d.name_ar : d.name_en) ?? "—", d.count, Number(d.amount)]) }
    }
    case "revenue_by_service": {
      const s = await summary()
      const list = (s.by_service ?? []) as { name_en: string; name_ar: string; amount: number; count: number }[]
      return { columns: ["service", "quantity", "revenue"], money: [2], rows: list.map((d) => [ar ? d.name_ar : d.name_en, d.count, Number(d.amount)]) }
    }
    case "payment_methods": {
      const s = await summary()
      const list = (s.by_method ?? []) as { method: string; amount: number }[]
      return { columns: ["method", "amount"], money: [1], rows: list.map((d) => [d.method, Number(d.amount)]) }
    }
    case "cash_collection":
    case "insurance_collection":
    case "refunds":
    case "payments": {
      let q = payments()
      if (kind === "cash_collection") q = q.eq("method", "cash")
      if (kind === "insurance_collection") q = q.eq("payer", "insurance")
      if (kind === "refunds") q = q.eq("kind", "refund")
      const { data } = await q
      return {
        columns: ["receipt", "date", "patient", "invoice", "method", "kind", "reason", "amount"],
        money: [7],
        rows: ((data ?? []) as unknown as Pay[]).map((p) => [
          p.receipt_number,
          day(p.received_at),
          p.patient?.full_name ?? "",
          p.invoice?.invoice_number ?? "",
          p.method,
          p.kind,
          p.reason ?? "",
          (p.kind === "refund" ? -1 : 1) * Number(p.amount),
        ]),
      }
    }
    case "outstanding_insurance":
    case "patient_balances": {
      const balanceCol = kind === "outstanding_insurance" ? "balance_insurance" : "balance_patient"
      const { data } = await invoices(supabase).gt(balanceCol, 0).order("issued_at")
      return {
        columns: kind === "outstanding_insurance" ? ["invoice", "date", "patient", "insurance", "claim_ref", "outstanding"] : ["invoice", "date", "patient", "patient_share", "paid", "outstanding"],
        money: kind === "outstanding_insurance" ? [5] : [3, 4, 5],
        rows: ((data ?? []) as unknown as Inv[]).map((i) =>
          kind === "outstanding_insurance"
            ? [i.invoice_number, day(i.issued_at), i.patient?.full_name ?? "", i.company ? (ar ? i.company.name_ar : i.company.name_en) : "", i.insurance_claim_ref ?? "", Number(i.balance_insurance)]
            : [i.invoice_number, day(i.issued_at), i.patient?.full_name ?? "", Number(i.total) - Number(i.insurance_amount), Number(i.paid_patient), Number(i.balance_patient)],
        ),
      }
    }
    case "discounts":
    case "invoices": {
      let q = invoices(supabase).gte("issued_at", start).lt("issued_at", end).order("issued_at")
      if (kind === "discounts") q = q.gt("discount_amount", 0)
      const { data } = await q
      const list = (data ?? []) as unknown as Inv[]
      return kind === "discounts"
        ? {
            columns: ["invoice", "date", "patient", "subtotal", "discount", "reason", "total"],
            money: [3, 4, 6],
            rows: list.map((i) => [i.invoice_number, day(i.issued_at), i.patient?.full_name ?? "", Number(i.subtotal), Number(i.discount_amount), i.discount_reason ?? "", Number(i.total)]),
          }
        : {
            columns: ["invoice", "date", "patient", "payment_type", "status", "total", "insurance", "paid", "outstanding"],
            money: [5, 6, 7, 8],
            rows: list.map((i) => [
              i.invoice_number,
              day(i.issued_at),
              i.patient?.full_name ?? "",
              i.payment_type,
              i.status,
              Number(i.total),
              Number(i.insurance_amount),
              Number(i.paid_patient) + Number(i.paid_insurance),
              Number(i.balance_patient) + Number(i.balance_insurance),
            ]),
          }
    }
  }
}

export { toCsv } from "./csv"
