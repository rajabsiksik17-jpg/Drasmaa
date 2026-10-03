export const ACCOUNTING_REPORTS = [
  "daily_revenue",
  "revenue_by_doctor",
  "revenue_by_service",
  "payment_methods",
  "cash_collection",
  "insurance_collection",
  "outstanding_insurance",
  "patient_balances",
  "discounts",
  "refunds",
  "invoices",
  "payments",
] as const
export type AccountingReport = (typeof ACCOUNTING_REPORTS)[number]
export const isAccountingReport = (v: unknown): v is AccountingReport => typeof v === "string" && (ACCOUNTING_REPORTS as readonly string[]).includes(v)
