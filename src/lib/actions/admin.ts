"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"

const label = z.string().trim().min(1).max(120)

// ---------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------
const newUserSchema = z.object({
  email: z.email().max(200),
  full_name: label,
  full_name_ar: z.string().trim().max(120).optional().nullable(),
  password: z.string().min(10).max(72),
  role_code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  department_id: z.uuid().optional().nullable(),
})

export async function createUser(input: z.input<typeof newUserSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.usersManage)
  if (auth.error) return auth.error
  const parsed = newUserSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data

  // Role/department go in app_metadata (not user-editable); the database
  // trigger creates the profile (and the doctor record for doctors).
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email: v.email,
    password: v.password,
    email_confirm: true,
    app_metadata: { role: v.role_code, department_id: v.department_id ?? null },
    user_metadata: { full_name: v.full_name, full_name_ar: v.full_name_ar ?? null },
  })
  if (error || !data.user) {
    console.error(`[admin] createUser failed: ${error?.code ?? error?.status ?? "unknown"}`)
    return fail(error?.code === "email_exists" ? "duplicate" : "unexpected")
  }
  revalidatePath("/admin/users")
  return ok({ id: data.user.id })
}

export async function sendPasswordReset(email: string, origin: string): Promise<ActionResult> {
  const auth = await authorize(P.usersManage)
  if (auth.error) return auth.error
  if (!z.email().safeParse(email).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/login/reset`,
  })
  if (error) {
    console.error(`[admin] password reset e-mail failed: ${error.code ?? error.status ?? "unknown"}`)
    return fail(error.status === 429 ? "rateLimited" : "emailFailed")
  }
  return ok(undefined)
}

// ---------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------
export async function setRolePermission(input: {
  roleId: string
  permission: string
  granted: boolean
}): Promise<ActionResult> {
  const auth = await authorize(P.rolesManage)
  if (auth.error) return auth.error
  const parsed = z
    .object({ roleId: z.uuid(), permission: z.string().regex(/^[a-z_]+\.[a-z_]+$/), granted: z.boolean() })
    .safeParse(input)
  if (!parsed.success) return fail("validation")
  const supabase = await createClient()
  const { error } = parsed.data.granted
    ? await supabase
        .from("role_permissions")
        .upsert({ role_id: parsed.data.roleId, permission_code: parsed.data.permission }, { ignoreDuplicates: true })
    : await supabase
        .from("role_permissions")
        .delete()
        .eq("role_id", parsed.data.roleId)
        .eq("permission_code", parsed.data.permission)
  if (error) return dbFail("setRolePermission", error)
  revalidatePath("/admin/roles")
  return ok(undefined)
}

export async function createRole(input: { code: string; name_en: string; name_ar: string }): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.rolesManage)
  if (auth.error) return auth.error
  const parsed = z
    .object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), name_en: label, name_ar: label })
    .safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const supabase = await createClient()
  const { data, error } = await supabase.from("roles").insert(parsed.data).select("id").single()
  if (error) return dbFail("createRole", error)
  revalidatePath("/admin/roles")
  return ok(data)
}

// ---------------------------------------------------------------------
// Configuration tables (never hard-deleted: deactivate instead)
// ---------------------------------------------------------------------
const CONFIG = {
  departments: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name_en: label,
    name_ar: label,
    active: z.boolean(),
    sort_order: z.number().int().min(0).max(9999),
  }),
  insurance_companies: z.object({
    code: z.string().regex(/^[a-z0-9_]*$/).nullable().optional(),
    name_en: label,
    name_ar: label,
    active: z.boolean(),
    sort_order: z.number().int().min(0).max(9999),
  }),
  dropdown_options: z.object({
    category: z.string().regex(/^[a-z][a-z0-9_]*$/),
    value: z.string().trim().min(1).max(60),
    label_en: label,
    label_ar: label,
    active: z.boolean(),
    sort_order: z.number().int().min(0).max(9999),
  }),
  doctors: z.object({
    display_name_en: label,
    display_name_ar: z.string().trim().max(120).nullable().optional(),
    department_id: z.uuid().nullable().optional(),
    specialty: z.string().trim().max(120).nullable().optional(),
    title_en: z.string().trim().max(120).nullable().optional(),
    title_ar: z.string().trim().max(120).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    profile_id: z.uuid().nullable().optional(),
    active: z.boolean(),
    sort_order: z.number().int().min(0).max(9999),
  }),
} as const

export type ConfigTable = keyof typeof CONFIG

export async function saveConfigRow(input: {
  table: ConfigTable
  id?: string | null
  values: Record<string, unknown>
}): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const schema = CONFIG[input.table]
  if (!schema) return fail("validation")
  // Empty form inputs mean "no value".
  const values = Object.fromEntries(Object.entries(input.values).map(([k, v]) => [k, v === "" ? null : v]))
  const parsed = input.id ? schema.partial().safeParse(values) : schema.safeParse(values)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const supabase = await createClient()
  const query = input.id
    ? supabase.from(input.table).update(parsed.data).eq("id", input.id).select("id").single()
    : supabase.from(input.table).insert(parsed.data).select("id").single()
  const { data, error } = await query
  if (error) return dbFail(`saveConfigRow ${input.table}`, error)
  revalidatePath("/admin", "layout")
  return ok(data)
}

export async function reorderConfigRows(table: ConfigTable, orderedIds: string[]): Promise<ActionResult> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  if (!z.array(z.uuid()).max(500).safeParse(orderedIds).success) return fail("validation")
  const supabase = await createClient()
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await supabase.from(table).update({ sort_order: index + 1 }).eq("id", id)
    if (error) return dbFail("reorderConfigRows", error)
  }
  revalidatePath("/admin", "layout")
  return ok(undefined)
}

const settingsSchema = z.object({
  clinic_name_en: label,
  clinic_name_ar: label,
  phone: z.string().trim().max(60).nullable(),
  email: z.union([z.email(), z.literal("")]).nullable().transform((v) => v || null),
  address_en: z.string().trim().max(300).nullable(),
  address_ar: z.string().trim().max(300).nullable(),
  default_language: z.enum(["en", "ar"]),
  appointment_slot_minutes: z.number().int().min(5).max(240),
  working_hours_start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  working_hours_end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  doctor_access_scope: z.enum(["all", "department", "assigned"]),
  receptionist_history_days: z.number().int().min(1).max(3650),
  max_upload_mb: z.number().int().min(1).max(50),
  mobile: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  whatsapp: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  city_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  city_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  country_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  country_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  location_text: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  license_text: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  header_text_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  header_text_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  footer_text_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  footer_text_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  report_footer_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  report_footer_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  prescription_footer_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  prescription_footer_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  invoice_footer_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  invoice_footer_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  receipt_footer_en: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  receipt_footer_ar: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  website: z.union([z.string().trim().regex(/^https?:\/\/[^\s]+$/), z.literal("")]).nullable().optional().transform((v) => v || null),
  maps_url: z.union([z.string().trim().regex(/^https:\/\/[^\s]+$/), z.literal("")]).nullable().optional().transform((v) => v || null),
  main_doctor_id: z.union([z.uuid(), z.literal("")]).nullable().optional().transform((v) => v || null),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  invoice_prefix: z.string().regex(/^[A-Z]{1,6}$/).optional(),
  receipt_prefix: z.string().regex(/^[A-Z]{1,6}$/).optional(),
  report_prefix: z.string().regex(/^[A-Z]{1,6}$/).optional(),
  prescription_prefix: z.string().regex(/^[A-Z]{1,6}$/).optional(),
})

export async function saveClinicSettings(
  values: z.input<typeof settingsSchema>,
  expectedVersion: number,
): Promise<ActionResult<{ version: number }>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const parsed = settingsSchema.safeParse(values)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clinic_settings")
    .update(parsed.data)
    .eq("id", 1)
    .eq("version", expectedVersion)
    .select("version")
    .maybeSingle()
  if (error) return dbFail("saveClinicSettings", error)
  if (!data) return fail("conflict")
  revalidatePath("/", "layout")
  return ok(data)
}

const SIGNATURE_TYPES: Record<string, { ext: string; magic: number[] }> = {
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/webp": { ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
}

/**
 * Doctor signature image (private bucket). Content is checked by its
 * magic bytes, not by the uploaded file name. It is only ever embedded in
 * documents generated by that doctor.
 */
export async function uploadDoctorSignature(formData: FormData): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const doctorId = String(formData.get("doctorId") ?? "")
  const file = formData.get("file")
  if (!z.uuid().safeParse(doctorId).success || !(file instanceof File)) return fail("validation")
  const kind = SIGNATURE_TYPES[file.type]
  if (!kind) return fail("fileType")
  if (file.size <= 0 || file.size > 1024 * 1024) return fail("fileTooLarge")
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!kind.magic.every((b, i) => bytes[i] === b)) return fail("fileType")
  const supabase = await createClient()
  const path = `signatures/${doctorId}/${crypto.randomUUID()}.${kind.ext}`
  const { error: upError } = await supabase.storage.from("clinic-private").upload(path, bytes, { contentType: file.type, upsert: false })
  if (upError) {
    console.error(`[admin] signature upload failed: ${upError.message}`)
    return fail("uploadFailed")
  }
  const { data: before } = await supabase.from("doctors").select("signature_path").eq("id", doctorId).maybeSingle()
  const { error } = await supabase.from("doctors").update({ signature_path: path }).eq("id", doctorId)
  if (error) return dbFail("uploadDoctorSignature", error)
  if (before?.signature_path) await createAdminClient().storage.from("clinic-private").remove([before.signature_path])
  revalidatePath("/admin/doctors")
  return ok(undefined)
}

export async function removeDoctorSignature(doctorId: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(doctorId).success) return fail("validation")
  const supabase = await createClient()
  const { data: before } = await supabase.from("doctors").select("signature_path").eq("id", doctorId).maybeSingle()
  const { error } = await supabase.from("doctors").update({ signature_path: null }).eq("id", doctorId)
  if (error) return dbFail("removeDoctorSignature", error)
  if (before?.signature_path) await createAdminClient().storage.from("clinic-private").remove([before.signature_path])
  revalidatePath("/admin/doctors")
  return ok(undefined)
}

const LOGO_TYPES: Record<string, { ext: string; check: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", check: (b) => b[0] === 0x89 && b[1] === 0x50 },
  "image/jpeg": { ext: "jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "image/webp": { ext: "webp", check: (b) => b.subarray(8, 12).toString() === "WEBP" },
}

/** Clinic logo (public branding bucket — never patient data). */
export async function uploadClinicLogo(formData: FormData): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const slot = formData.get("slot") === "secondary" ? "secondary_logo_path" : "logo_path"
  const file = formData.get("file")
  if (!(file instanceof File)) return fail("validation")
  const kind = LOGO_TYPES[file.type]
  if (!kind) return fail("fileType")
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) return fail("fileTooLarge")
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!kind.check(bytes)) return fail("fileType")
  const supabase = await createClient()
  const path = `logos/${crypto.randomUUID()}.${kind.ext}`
  const { error: upError } = await supabase.storage.from("clinic-assets").upload(path, bytes, { contentType: file.type, upsert: false })
  if (upError) {
    console.error(`[admin] logo upload failed: ${upError.message}`)
    return fail("uploadFailed")
  }
  const { error } = await supabase.from("clinic_settings").update({ [slot]: path }).eq("id", 1)
  if (error) return dbFail("uploadClinicLogo", error)
  revalidatePath("/", "layout")
  return ok(undefined)
}

export async function removeClinicLogo(slot: "primary" | "secondary"): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  const supabase = await createClient()
  const { error } = await supabase.from("clinic_settings").update({ [slot === "secondary" ? "secondary_logo_path" : "logo_path"]: null }).eq("id", 1)
  if (error) return dbFail("removeClinicLogo", error)
  revalidatePath("/", "layout")
  return ok(undefined)
}
