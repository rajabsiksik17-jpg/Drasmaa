"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { dbFail, fail, logDbError, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"

const label = z.string().trim().min(1).max(120)
const optional = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null)

// ---------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------
const userSchema = z.object({
  id: z.uuid(),
  full_name: label,
  full_name_ar: optional(120),
  phone: optional(40),
  email: z.email().max(200),
  role_id: z.uuid().nullable(),
  department_id: z.uuid().nullable(),
})

/** Edits a staff account (profile + login e-mail). Role changes need a reason-free admin action, never on oneself. */
export async function saveUser(input: z.input<typeof userSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.usersManage)
  if (auth.error) return auth.error
  const parsed = userSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  const supabase = await createClient()
  const { data: current, error: readError } = await supabase.from("profiles").select("email, role_id").eq("id", v.id).maybeSingle()
  if (readError) return dbFail("saveUser read", readError)
  if (!current) return fail("notFound")
  if (v.id === auth.session.userId && v.role_id !== current.role_id) return fail("forbidden")

  // The login e-mail lives in Supabase Auth; change it there first.
  if (v.email.toLowerCase() !== (current.email ?? "").toLowerCase()) {
    const { error } = await createAdminClient().auth.admin.updateUserById(v.id, { email: v.email, email_confirm: true })
    if (error) {
      console.error(`[staff] email change failed: ${error.code ?? error.status ?? "unknown"}`)
      return fail(error.code === "email_exists" ? "duplicate" : "unexpected")
    }
  }
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: v.full_name, full_name_ar: v.full_name_ar, phone: v.phone, email: v.email, role_id: v.role_id, department_id: v.department_id })
    .eq("id", v.id)
  if (error) return dbFail("saveUser", error)
  revalidatePath("/admin/users")
  return ok(undefined)
}

/**
 * Deactivate / reactivate. A deactivated account is signed out everywhere
 * (banned in Auth) and RLS already denies every request of an inactive
 * profile. Failures are reported, never hidden.
 */
export async function setUserActive(id: string, active: boolean): Promise<ActionResult<void>> {
  const auth = await authorize(P.usersManage)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  if (id === auth.session.userId) return fail("forbidden")
  const supabase = await createClient()
  const { error } = await supabase.from("profiles").update({ active }).eq("id", id)
  if (error) return dbFail("setUserActive", error)
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" })
  if (banError) {
    // The profile flag is authoritative for access; the Auth ban only ends live sessions sooner.
    console.error(`[staff] auth ban update failed: ${banError.code ?? banError.status ?? "unknown"}`)
  }
  if (!active) {
    const { error: sessError } = await createAdminClient().from("user_sessions").update({ status: "revoked", ended_at: new Date().toISOString(), revoke_reason: "Account deactivated" }).eq("user_id", id).in("status", ["active", "pending_otp"])
    if (sessError) logDbError("setUserActive revoke sessions", sessError)
  }
  revalidatePath("/admin/users")
  return ok(undefined)
}

/**
 * Hard delete only for accounts that never touched clinical, financial or
 * administrative data (nothing in the audit log, no doctor record with
 * history). Everyone else is deactivated to keep history intact.
 */
export async function deleteUser(id: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.usersManage)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  if (id === auth.session.userId) return fail("forbidden")
  const admin = createAdminClient()
  const [{ count: audits, error: e1 }, { data: doctor, error: e2 }] = await Promise.all([
    admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("actor_id", id),
    admin.from("doctors").select("id").eq("profile_id", id).maybeSingle(),
  ])
  if (e1 || e2) return dbFail("deleteUser check", e1 ?? e2)
  if ((audits ?? 0) > 0 || doctor) return fail("inUse")
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) {
    console.error(`[staff] deleteUser failed: ${error.code ?? error.status ?? "unknown"}`)
    return fail("inUse")
  }
  revalidatePath("/admin/users")
  return ok(undefined)
}

// ---------------------------------------------------------------------
// Doctors
// ---------------------------------------------------------------------
const doctorSchema = z.object({
  id: z.uuid().nullable().optional(),
  display_name_en: label,
  display_name_ar: optional(120),
  specialty: optional(120),
  title_en: optional(120),
  title_ar: optional(120),
  department_id: z.uuid().nullable().optional(),
  profile_id: z.uuid().nullable().optional(),
  phone: optional(40),
  email: z.union([z.email().max(200), z.literal("")]).nullable().optional().transform((v) => v || null),
  license_number: optional(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  active: z.boolean(),
})

export async function saveDoctor(input: z.input<typeof doctorSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const parsed = doctorSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { id, ...values } = parsed.data
  const supabase = await createClient()
  const query = id
    ? supabase.from("doctors").update(values).eq("id", id).select("id").single()
    : supabase.from("doctors").insert(values).select("id").single()
  const { data, error } = await query
  if (error) return dbFail("saveDoctor", error)
  revalidatePath("/admin/doctors")
  revalidatePath("/", "layout")
  return ok(data)
}

const hoursSchema = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), start_time: z.string().regex(/^\d{2}:\d{2}$/), end_time: z.string().regex(/^\d{2}:\d{2}$/) }))
  .max(42)
  .refine((rows) => rows.every((r) => r.end_time > r.start_time), { message: "invalidValue" })

/** Weekly schedule (empty = follows the clinic working hours). */
export async function saveDoctorHours(doctorId: string, hours: z.input<typeof hoursSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const parsed = hoursSchema.safeParse(hours)
  if (!z.uuid().safeParse(doctorId).success || !parsed.success) return fail("validation", ["working_hours"])
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_doctor_working_hours", { p_doctor: doctorId, p_hours: parsed.data })
  if (error) return dbFail("saveDoctorHours", error)
  revalidatePath("/admin/doctors")
  revalidatePath("/", "layout")
  return ok(undefined)
}

const priceSchema = z.object({
  doctorId: z.uuid(),
  serviceId: z.uuid(),
  priceCash: z.number().min(0).max(1_000_000).nullable(),
  priceInsurance: z.number().min(0).max(1_000_000).nullable(),
})

/** Doctor's own price for a service (null cash price = use the catalog). Old invoices keep their snapshot. */
export async function saveDoctorPrice(input: z.input<typeof priceSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.pricingManage)
  if (auth.error) return auth.error
  const parsed = priceSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  const supabase = await createClient()
  const { error } =
    v.priceCash == null
      ? await supabase.from("doctor_service_prices").delete().eq("doctor_id", v.doctorId).eq("service_id", v.serviceId)
      : await supabase
          .from("doctor_service_prices")
          .upsert({ doctor_id: v.doctorId, service_id: v.serviceId, price_cash: v.priceCash, price_insurance: v.priceInsurance })
  if (error) return dbFail("saveDoctorPrice", error)
  revalidatePath("/admin/doctors")
  return ok(undefined)
}

const PHOTO_TYPES: Record<string, { ext: string; check: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", check: (b) => b[0] === 0x89 && b[1] === 0x50 },
  "image/jpeg": { ext: "jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "image/webp": { ext: "webp", check: (b) => b.subarray(8, 12).toString() === "WEBP" },
}

/** Doctor profile photo (branding bucket; never patient data). */
export async function uploadDoctorPhoto(formData: FormData): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const doctorId = String(formData.get("doctorId") ?? "")
  const file = formData.get("file")
  if (!z.uuid().safeParse(doctorId).success || !(file instanceof File)) return fail("validation")
  const kind = PHOTO_TYPES[file.type]
  if (!kind) return fail("fileType")
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) return fail("fileTooLarge")
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!kind.check(bytes)) return fail("fileType")
  const supabase = await createClient()
  const { data: doctor } = await supabase.from("doctors").select("photo_path").eq("id", doctorId).maybeSingle()
  if (!doctor) return fail("notFound")
  const path = `doctors/${crypto.randomUUID()}.${kind.ext}`
  const { error: upError } = await supabase.storage.from("clinic-assets").upload(path, bytes, { contentType: file.type, upsert: false })
  if (upError) {
    console.error(`[staff] photo upload failed: ${upError.message}`)
    return fail("uploadFailed")
  }
  const { error } = await supabase.from("doctors").update({ photo_path: path }).eq("id", doctorId)
  if (error) {
    await supabase.storage.from("clinic-assets").remove([path])
    return dbFail("uploadDoctorPhoto", error)
  }
  if (doctor.photo_path) {
    const { error: rmError } = await supabase.storage.from("clinic-assets").remove([doctor.photo_path])
    if (rmError) console.error(`[staff] old photo cleanup failed: ${rmError.message}`)
  }
  revalidatePath("/admin/doctors")
  return ok(undefined)
}

export async function removeDoctorPhoto(doctorId: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(doctorId).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("doctors").update({ photo_path: null }).eq("id", doctorId)
  if (error) return dbFail("removeDoctorPhoto", error)
  revalidatePath("/admin/doctors")
  return ok(undefined)
}

/** Hard delete only when the doctor has no history; otherwise deactivate. */
export async function deleteDoctor(id: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const admin = createAdminClient()
  const counts = await Promise.all(
    (["appointments", "visits", "encounters", "invoices"] as const).map((t) =>
      admin.from(t).select("id", { count: "exact", head: true }).eq("doctor_id", id),
    ),
  )
  const patients = await admin.from("patients").select("id", { count: "exact", head: true }).eq("assigned_doctor_id", id)
  const failed = [...counts, patients].find((c) => c.error)
  if (failed?.error) return dbFail("deleteDoctor check", failed.error)
  if ([...counts, patients].some((c) => (c.count ?? 0) > 0)) return fail("inUse")
  const { error } = await admin.from("doctors").delete().eq("id", id)
  if (error) {
    logDbError("deleteDoctor", error)
    return fail(error.code === "23503" ? "inUse" : "unexpected")
  }
  revalidatePath("/admin/doctors")
  revalidatePath("/", "layout")
  return ok(undefined)
}

// ---------------------------------------------------------------------
// Billing workflow settings
// ---------------------------------------------------------------------
const billingSchema = z.object({
  collect_payment_before_consultation: z.boolean(),
  enforce_working_hours: z.boolean(),
  working_days: z.array(z.number().int().min(0).max(6)).max(7),
  payment_methods: z.array(z.enum(["cash", "card", "transfer", "other"])).min(1),
})

export async function saveBillingSettings(input: z.input<typeof billingSchema>, expectedVersion: number): Promise<ActionResult<{ version: number }>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const parsed = billingSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clinic_settings")
    .update({ ...v, working_days: [...new Set(v.working_days)].sort(), payment_methods: [...new Set(v.payment_methods)] })
    .eq("id", 1)
    .eq("version", expectedVersion)
    .select("version")
    .maybeSingle()
  if (error) return dbFail("saveBillingSettings", error)
  if (!data) return fail("conflict")
  revalidatePath("/", "layout")
  return ok(data)
}

/** Maximum discount a role may give (null = unlimited). */
export async function saveRoleDiscountLimit(roleId: string, percent: number | null): Promise<ActionResult<void>> {
  const auth = await authorize(P.rolesManage)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(roleId).success || (percent != null && !(percent >= 0 && percent <= 100))) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("roles").update({ max_discount_percent: percent }).eq("id", roleId)
  if (error) return dbFail("saveRoleDiscountLimit", error)
  revalidatePath("/admin/billing")
  return ok(undefined)
}
