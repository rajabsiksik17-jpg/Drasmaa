"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"

const money = z.number().min(0).max(1_000_000)
const serviceSchema = z.object({
  id: z.uuid().optional(),
  expectedVersion: z.number().int().optional(),
  category: z.enum(["consultation", "followup", "ultrasound", "investigation", "report", "certificate", "procedure", "treatment", "package", "other"]),
  name_en: z.string().trim().min(1).max(160),
  name_ar: z.string().trim().min(1).max(160),
  price_cash: money,
  price_insurance: money.nullable(),
  billable: z.boolean(),
  insurance_eligible: z.boolean(),
  default_duration_minutes: z.number().int().min(5).max(480).nullable(),
  appointment_type: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable(),
  auto_trigger: z.enum(["ultrasound", "medical_report", "medical_certificate"]).nullable(),
  notes: z.string().max(1000).nullable(),
  active: z.boolean(),
})

/** Create / edit a billable service. Old prices stay on old invoices (snapshots). */
export async function saveService(input: z.input<typeof serviceSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.pricingManage)
  if (auth.error) return auth.error
  const parsed = serviceSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { id, expectedVersion, ...row } = parsed.data
  const supabase = await createClient()
  const values = { ...row, notes: row.notes?.trim() || null }
  if (id) {
    let q = supabase.from("services").update(values).eq("id", id)
    if (expectedVersion != null) q = q.eq("version", expectedVersion)
    const { data, error } = await q.select("id").maybeSingle()
    if (error) return dbFail("saveService", error)
    if (!data) return fail("conflict")
    revalidatePath("/admin/pricing")
    return ok({ id: data.id })
  }
  const { data, error } = await supabase.from("services").insert({ ...values, sort_order: 500 }).select("id").single()
  if (error) return dbFail("createService", error)
  revalidatePath("/admin/pricing")
  return ok({ id: data.id })
}

const insurancePriceSchema = z.object({
  serviceId: z.uuid(),
  insuranceCompanyId: z.uuid(),
  price: money.nullable(),
  coveragePercent: z.number().min(0).max(100).nullable(),
})

/** Insurance-company specific price (null price removes the special price). */
export async function saveInsurancePrice(input: z.input<typeof insurancePriceSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.pricingManage)
  if (auth.error) return auth.error
  const parsed = insurancePriceSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  const supabase = await createClient()
  const { error } =
    v.price === null
      ? await supabase.from("service_insurance_prices").delete().eq("service_id", v.serviceId).eq("insurance_company_id", v.insuranceCompanyId)
      : await supabase.from("service_insurance_prices").upsert(
          { service_id: v.serviceId, insurance_company_id: v.insuranceCompanyId, price: v.price, coverage_percent: v.coveragePercent, updated_at: new Date().toISOString(), updated_by: auth.session.userId },
          { onConflict: "service_id,insurance_company_id" },
        )
  if (error) return dbFail("saveInsurancePrice", error)
  revalidatePath("/admin/pricing")
  return ok(undefined)
}

const coverageSchema = z.object({ insuranceCompanyId: z.uuid(), percent: z.number().min(0).max(100).nullable() })

export async function saveInsuranceCoverage(input: z.input<typeof coverageSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.pricingManage)
  if (auth.error) return auth.error
  const parsed = coverageSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("insurance_companies").update({ default_coverage_percent: parsed.data.percent }).eq("id", parsed.data.insuranceCompanyId)
  if (error) return dbFail("saveInsuranceCoverage", error)
  revalidatePath("/admin/pricing")
  return ok(undefined)
}

const packageSchema = z.object({
  packageId: z.uuid(),
  items: z.array(z.object({ serviceId: z.uuid(), quantity: z.number().int().min(1).max(50) })).max(30),
})

/** Package components (listed at price 0 under the package line — no double charge). */
export async function savePackageItems(input: z.input<typeof packageSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.pricingManage)
  if (auth.error) return auth.error
  const parsed = packageSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const { packageId, items } = parsed.data
  if (items.some((i) => i.serviceId === packageId)) return fail("validation")
  const supabase = await createClient()
  const { data: pkg } = await supabase.from("services").select("category").eq("id", packageId).maybeSingle()
  if (pkg?.category !== "package") return fail("validation")
  const { error: delError } = await supabase.from("service_package_items").delete().eq("package_id", packageId)
  if (delError) return dbFail("savePackageItems", delError)
  if (items.length) {
    const { error } = await supabase
      .from("service_package_items")
      .insert(items.map((i) => ({ package_id: packageId, service_id: i.serviceId, quantity: i.quantity })))
    if (error) return dbFail("savePackageItems", error)
  }
  revalidatePath("/admin/pricing")
  return ok(undefined)
}

export interface PriceHistoryRow {
  id: number
  price_cash: number | null
  price_insurance: number | null
  changed_at: string
  changed_by: string | null
}

export async function servicePriceHistory(serviceId: string): Promise<ActionResult<PriceHistoryRow[]>> {
  const auth = await authorize(P.pricingView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(serviceId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("service_price_history")
    .select("id, price_cash, price_insurance, changed_at, changed_by")
    .eq("service_id", serviceId)
    .order("changed_at", { ascending: false })
    .limit(50)
  if (error) return dbFail("servicePriceHistory", error)
  return ok((data ?? []) as PriceHistoryRow[])
}
