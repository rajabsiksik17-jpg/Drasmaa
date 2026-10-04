"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { limit } from "@/lib/security/rate-limit"

const refresh = (invoiceId?: string, patientId?: string) => {
  revalidatePath("/accounting", "layout")
  revalidatePath("/appointments")
  if (invoiceId) revalidatePath(`/accounting/invoices/${invoiceId}`)
  if (patientId) revalidatePath(`/patients/${patientId}`)
}

/** The invoice of an appointment (created with its service on first use). */
export async function openAppointmentInvoice(appointmentId: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.accountingCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(appointmentId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("ensure_appointment_invoice", { p_appointment: appointmentId })
  if (error) return dbFail("openAppointmentInvoice", error)
  refresh(data as string)
  return ok({ id: data as string })
}

/** A new invoice for a patient (walk-in service, report, ...). */
export async function createPatientInvoice(patientId: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.accountingCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const { data: p } = await supabase.from("patients").select("payment_method, insurance_company_id, assigned_doctor_id").eq("id", patientId).maybeSingle()
  if (!p) return fail("notFound")
  const insurance = p.payment_method === "insurance" && p.insurance_company_id
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      patient_id: patientId,
      doctor_id: p.assigned_doctor_id,
      payment_type: insurance ? "insurance" : "cash",
      insurance_company_id: insurance ? p.insurance_company_id : null,
    })
    .select("id")
    .single()
  if (error) return dbFail("createPatientInvoice", error)
  refresh(data.id, patientId)
  return ok({ id: data.id })
}

const addSchema = z.object({ invoiceId: z.uuid(), serviceId: z.uuid(), quantity: z.number().int().min(1).max(100).default(1) })

export async function addInvoiceService(input: z.input<typeof addSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingCreate, P.billingCharge)
  if (auth.error) return auth.error
  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.rpc("add_invoice_service", {
    p_invoice: parsed.data.invoiceId,
    p_service: parsed.data.serviceId,
    p_quantity: parsed.data.quantity,
  })
  if (error) return dbFail("addInvoiceService", error)
  refresh(parsed.data.invoiceId)
  return ok(undefined)
}

const lineSchema = z.object({
  lineId: z.uuid(),
  quantity: z.number().int().min(1).max(100).optional(),
  unitPrice: z.number().min(0).max(1_000_000).optional(),
  remove: z.boolean().optional(),
  reason: z.string().max(300).nullable().optional(),
})

/**
 * Change or remove a line. Changing a price away from the catalog needs
 * pricing.manage; once anything was paid, the database requires
 * accounting.edit and a reason (audited).
 */
export async function updateInvoiceLine(input: z.input<typeof lineSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingCreate, P.accountingEdit, P.billingCharge)
  if (auth.error) return auth.error
  const parsed = lineSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  if (v.unitPrice !== undefined && !auth.session.permissions.includes(P.pricingManage) && !auth.session.permissions.includes(P.accountingEdit)) {
    return fail("forbidden")
  }
  const supabase = await createClient({ auditReason: v.reason })
  const { data: line } = await supabase.from("invoice_lines").select("invoice_id, package_line_id").eq("id", v.lineId).maybeSingle()
  if (!line) return fail("notFound")
  if (line.package_line_id) return fail("validation")
  const { error } = v.remove
    ? await supabase.from("invoice_lines").delete().eq("id", v.lineId)
    : await supabase
        .from("invoice_lines")
        .update({ ...(v.quantity !== undefined ? { quantity: v.quantity } : {}), ...(v.unitPrice !== undefined ? { unit_price: v.unitPrice } : {}) })
        .eq("id", v.lineId)
  if (error) return dbFail("updateInvoiceLine", error)
  refresh(line.invoice_id)
  return ok(undefined)
}

const invoiceSchema = z.object({
  invoiceId: z.uuid(),
  expectedVersion: z.number().int(),
  paymentType: z.enum(["cash", "insurance", "mixed"]),
  insuranceCompanyId: z.uuid().nullable(),
  insuranceAmount: z.number().min(0).max(1_000_000),
  insuranceClaimRef: z.string().max(80).nullable(),
  discountType: z.enum(["percent", "fixed"]).nullable(),
  discountValue: z.number().min(0).max(1_000_000),
  discountReason: z.string().max(300).nullable(),
  notes: z.string().max(2000).nullable(),
  reason: z.string().max(300).nullable().optional(),
})

export async function updateInvoice(input: z.input<typeof invoiceSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingCreate, P.accountingEdit, P.billingCharge)
  if (auth.error) return auth.error
  const parsed = invoiceSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  if (v.paymentType !== "cash" && !v.insuranceCompanyId) return fail("validation", ["insuranceCompanyId"])
  if (v.discountType === "percent" && v.discountValue > 100) return fail("validation", ["discountValue"])
  const supabase = await createClient({ auditReason: v.reason })
  const { data, error } = await supabase
    .from("invoices")
    .update({
      payment_type: v.paymentType,
      insurance_company_id: v.paymentType === "cash" ? null : v.insuranceCompanyId,
      insurance_amount: v.paymentType === "cash" ? 0 : v.insuranceAmount,
      insurance_claim_ref: v.insuranceClaimRef?.trim() || null,
      discount_type: v.discountValue > 0 ? v.discountType : null,
      discount_value: v.discountType ? v.discountValue : 0,
      discount_reason: v.discountReason?.trim() || null,
      notes: v.notes?.trim() || null,
    })
    .eq("id", v.invoiceId)
    .eq("version", v.expectedVersion)
    .select("patient_id")
    .maybeSingle()
  if (error) return dbFail("updateInvoice", error)
  if (!data) return fail("conflict")
  refresh(v.invoiceId, data.patient_id)
  return ok(undefined)
}

const paymentSchema = z.object({
  invoiceId: z.uuid(),
  // One key per checkout attempt (generated by the browser): makes retries idempotent.
  requestKey: z.uuid(),
  payments: z
    .array(
      z.object({
        payer: z.enum(["patient", "insurance"]),
        method: z.enum(["cash", "card", "transfer", "insurance", "other"]),
        amount: z.number().positive().max(1_000_000),
        reference: z.string().max(120).nullable().optional(),
      }),
    )
    .min(1)
    .max(5),
})

/**
 * Records one or several payments at once (e.g. cash + card): all or none,
 * exactly once per `requestKey` (double clicks / retries return the same
 * payments). Permanent.
 */
export async function recordPayments(input: z.input<typeof paymentSchema>): Promise<ActionResult<{ ids: string[] }>> {
  const auth = await authorize(P.accountingCreate)
  if (auth.error) return auth.error
  const parsed = paymentSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  if (!(await limit("sensitivePerUser", `pay:${auth.session.userId}`))) return fail("rateLimited")
  const supabase = await createClient()
  const payments = parsed.data.payments.map((p) => ({
    payer: p.payer,
    method: p.payer === "insurance" ? (p.method === "transfer" ? "transfer" : "insurance") : p.method === "insurance" ? "other" : p.method,
    amount: Math.round(p.amount * 1000) / 1000,
    reference: p.reference?.trim() || null,
  }))
  const { data, error } = await supabase.rpc("record_payments", {
    p_invoice: parsed.data.invoiceId,
    p_payments: payments,
    p_key: parsed.data.requestKey,
  })
  refresh(parsed.data.invoiceId)
  if (error) return dbFail("recordPayments", error)
  return ok({ ids: ((data ?? []) as unknown as string[]).map(String) })
}

const refundSchema = z.object({ paymentId: z.uuid(), amount: z.number().positive().max(1_000_000), reason: z.string().trim().min(3).max(300) })

/** Refund: a new negative movement linked to the original payment (never an edit). */
export async function refundPayment(input: z.input<typeof refundSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingRefund)
  if (auth.error) return auth.error
  const parsed = refundSchema.safeParse(input)
  if (!parsed.success) return fail("validation", ["reason"])
  const supabase = await createClient({ auditReason: parsed.data.reason })
  const { data: orig } = await supabase.from("payments").select("invoice_id, payer, method").eq("id", parsed.data.paymentId).maybeSingle()
  if (!orig) return fail("notFound")
  const { error } = await supabase.from("payments").insert({
    invoice_id: orig.invoice_id,
    kind: "refund",
    refund_of_id: parsed.data.paymentId,
    payer: orig.payer,
    method: orig.method,
    amount: Math.round(parsed.data.amount * 1000) / 1000,
    reason: parsed.data.reason,
    received_by: auth.session.userId,
  })
  if (error) return dbFail("refundPayment", error)
  refresh(orig.invoice_id)
  return ok(undefined)
}

export async function voidInvoice(invoiceId: string, reason: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(invoiceId).success || reason.trim().length < 3) return fail("validation", ["reason"])
  const supabase = await createClient({ auditReason: reason })
  const { data, error } = await supabase.from("invoices").update({ status: "void" }).eq("id", invoiceId).select("patient_id").maybeSingle()
  if (error) return dbFail("voidInvoice", error)
  if (!data) return fail("notFound")
  refresh(invoiceId, data.patient_id)
  return ok(undefined)
}

// ---------------------------------------------------------------------
// Daily cash register
// ---------------------------------------------------------------------
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export async function openRegister(input: { date: string; openingBalance: number }): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingCloseDay)
  if (auth.error) return auth.error
  if (!day.safeParse(input.date).success || !(input.openingBalance >= 0)) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("cash_registers").insert({ register_date: input.date, opening_balance: input.openingBalance })
  if (error) return dbFail("openRegister", error)
  refresh()
  return ok(undefined)
}

export async function addCashExpense(input: { date: string; amount: number; description: string }): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingCreate)
  if (auth.error) return auth.error
  if (!day.safeParse(input.date).success || !(input.amount > 0) || input.description.trim().length < 2) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase
    .from("cash_expenses")
    .insert({ register_date: input.date, amount: input.amount, description: input.description.trim().slice(0, 300), created_by: auth.session.userId })
  if (error) return dbFail("addCashExpense", error)
  refresh()
  return ok(undefined)
}

export async function closeRegister(input: { id: string; expectedVersion: number; actualCash: number; notes?: string }): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingCloseDay)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(input.id).success || !(input.actualCash >= 0)) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("cash_registers")
    .update({ status: "closed", actual_cash: input.actualCash, notes: input.notes?.trim() || null })
    .eq("id", input.id)
    .eq("version", input.expectedVersion)
    .select("id")
    .maybeSingle()
  if (error) return dbFail("closeRegister", error)
  if (!data) return fail("conflict")
  refresh()
  return ok(undefined)
}

export async function addRegisterAdjustment(input: { registerId: string; amount: number; reason: string }): Promise<ActionResult<void>> {
  const auth = await authorize(P.accountingEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(input.registerId).success || !input.amount || input.reason.trim().length < 3) return fail("validation")
  const supabase = await createClient({ auditReason: input.reason })
  const { error } = await supabase
    .from("cash_register_adjustments")
    .insert({ register_id: input.registerId, amount: input.amount, reason: input.reason.trim(), created_by: auth.session.userId })
  if (error) return dbFail("addRegisterAdjustment", error)
  refresh()
  return ok(undefined)
}
