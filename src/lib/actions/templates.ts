"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { limit } from "@/lib/security/rate-limit"
import { clinicInfo, isValidEmail, sendEmail } from "@/lib/email/send"
import { renderTemplate, sampleVariables, sanitizeSubject } from "@/lib/messaging/templates"

export interface MessageTemplate {
  id: string
  code: string | null
  channel: "email" | "whatsapp"
  category: string
  purpose: string
  name_en: string
  name_ar: string
  subject_en: string | null
  subject_ar: string | null
  body_en: string
  body_ar: string
  default_language: "ar" | "en"
  active: boolean
  is_system: boolean
  archived_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  version: number
}

export interface TemplateVersion {
  id: string
  template_id: string
  version_no: number
  name_en: string
  name_ar: string
  subject_en: string | null
  subject_ar: string | null
  body_en: string
  body_ar: string
  created_by: string | null
  created_at: string
}

const CATEGORIES = ["appointment", "medical_followup", "pregnancy", "fertility", "ivf", "general", "congratulations", "administrative", "security", "documents", "custom"] as const

const singleLine = z.string().max(200).regex(/^[^\r\n]*$/)
const templateSchema = z.object({
  id: z.uuid().optional(),
  expectedVersion: z.number().int().optional(),
  channel: z.enum(["email", "whatsapp"]),
  category: z.enum(CATEGORIES),
  purpose: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60).default("custom"),
  name_en: z.string().trim().min(1).max(120),
  name_ar: z.string().trim().min(1).max(120),
  subject_en: singleLine.nullable().optional(),
  subject_ar: singleLine.nullable().optional(),
  body_en: z.string().max(10000),
  body_ar: z.string().max(10000),
  default_language: z.enum(["ar", "en"]),
  active: z.boolean(),
})

export async function saveTemplate(input: z.input<typeof templateSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = templateSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const v = parsed.data
  if (!v.body_ar.trim() && !v.body_en.trim()) return fail("validation", ["body_ar"])
  const auth = await authorize(v.id ? P.templatesEdit : P.templatesCreate)
  if (auth.error) return auth.error
  const supabase = await createClient()
  if (!v.id && v.category === "security") return fail("validation", ["category"])
  if (v.id) {
    const { data: current } = await supabase.from("message_templates").select("purpose, category, is_system").eq("id", v.id).maybeSingle()
    if (!current) return fail("notFound")
    // Built-in purposes / security templates keep their identity.
    if (current.is_system || current.category === "security") {
      v.purpose = current.purpose
      v.category = current.category as typeof v.category
    }
    if (current.purpose === "otp_code" && ![v.body_en, v.body_ar].every((b) => /\{\{\s*otp_code\s*\}\}/.test(b))) {
      return fail("validation", ["body_ar"])
    }
  }
  const row = {
    category: v.category,
    purpose: v.purpose,
    name_en: v.name_en,
    name_ar: v.name_ar,
    subject_en: v.channel === "email" ? v.subject_en?.trim() || null : null,
    subject_ar: v.channel === "email" ? v.subject_ar?.trim() || null : null,
    body_en: v.body_en,
    body_ar: v.body_ar,
    default_language: v.default_language,
    active: v.active,
  }
  if (v.id) {
    let q = supabase.from("message_templates").update(row).eq("id", v.id)
    if (v.expectedVersion != null) q = q.eq("version", v.expectedVersion)
    const { data, error } = await q.select("id").maybeSingle()
    if (error) return dbFail("saveTemplate", error)
    if (!data) return fail("conflict")
    revalidatePath("/admin/templates")
    return ok({ id: data.id })
  }
  const { data, error } = await supabase
    .from("message_templates")
    .insert({ ...row, channel: v.channel, is_system: false, sort_order: 200 })
    .select("id")
    .single()
  if (error) return dbFail("createTemplate", error)
  revalidatePath("/admin/templates")
  return ok({ id: data.id })
}

export async function duplicateTemplate(id: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.templatesCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { data: t, error } = await supabase.from("message_templates").select("*").eq("id", id).maybeSingle()
  if (error) return dbFail("duplicateTemplate", error)
  if (!t) return fail("notFound")
  const { data, error: insError } = await supabase
    .from("message_templates")
    .insert({
      channel: t.channel,
      category: t.category === "security" ? "custom" : t.category,
      purpose: t.purpose,
      name_en: `${t.name_en} (copy)`.slice(0, 120),
      name_ar: `${t.name_ar} (نسخة)`.slice(0, 120),
      subject_en: t.subject_en,
      subject_ar: t.subject_ar,
      body_en: t.body_en,
      body_ar: t.body_ar,
      default_language: t.default_language,
      active: false,
      is_system: false,
      sort_order: 200,
    })
    .select("id")
    .single()
  if (insError) return dbFail("duplicateTemplate", insError)
  revalidatePath("/admin/templates")
  return ok({ id: data.id })
}

export async function setTemplateActive(id: string, active: boolean): Promise<ActionResult<void>> {
  const auth = await authorize(P.templatesEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("message_templates").update({ active }).eq("id", id)
  if (error) return dbFail("setTemplateActive", error)
  revalidatePath("/admin/templates")
  return ok(undefined)
}

/** "Delete" = archive (history and versions are kept; built-ins cannot be archived). */
export async function archiveTemplate(id: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.templatesDelete)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase
    .from("message_templates")
    .update({ archived_at: new Date().toISOString(), active: false })
    .eq("id", id)
  if (error) return dbFail("archiveTemplate", error)
  revalidatePath("/admin/templates")
  return ok(undefined)
}

export async function listTemplateVersions(id: string): Promise<ActionResult<TemplateVersion[]>> {
  const auth = await authorize(P.templatesView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("message_template_versions")
    .select("*")
    .eq("template_id", id)
    .order("version_no", { ascending: false })
    .limit(50)
  if (error) return dbFail("listTemplateVersions", error)
  return ok((data ?? []) as TemplateVersion[])
}

export async function restoreTemplateVersion(versionId: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.templatesEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(versionId).success) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.rpc("restore_message_template_version", { p_version: versionId })
  if (error) return dbFail("restoreTemplateVersion", error)
  revalidatePath("/admin/templates")
  return ok(undefined)
}

const testSchema = z.object({
  subject: singleLine,
  body: z.string().min(1).max(10000),
  language: z.enum(["ar", "en"]),
  to: z.email().max(320),
})

/** Sends the (unsaved) editor content with sample data to a test address. */
export async function sendTemplateTest(input: z.input<typeof testSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.templatesEdit, P.templatesCreate)
  if (auth.error) return auth.error
  const parsed = testSchema.safeParse(input)
  if (!parsed.success || !isValidEmail(parsed.data.to)) return fail("invalidEmail")
  if (!(await limit("emailTestPerUser", auth.session.userId))) return fail("rateLimited")
  const clinic = await clinicInfo(parsed.data.language)
  const vars = sampleVariables(parsed.data.language, clinic)
  const res = await sendEmail(
    {
      to: parsed.data.to,
      subject: sanitizeSubject(`[TEST] ${renderTemplate(parsed.data.subject, vars)}`),
      text: renderTemplate(parsed.data.body, vars),
      language: parsed.data.language,
    },
    clinic.name,
  )
  if (!res.ok) return fail(res.code === "not_configured" ? "emailNotConfigured" : "emailFailed", undefined, res.code)
  return ok(undefined)
}

const docTemplateSchema = z.object({
  document_type: z.string().regex(/^[a-z_]+$/),
  expectedVersion: z.number().int(),
  name_en: z.string().trim().min(1).max(120),
  name_ar: z.string().trim().min(1).max(120),
  orientation: z.enum(["portrait", "landscape"]),
  margin_top_mm: z.number().int().min(0).max(40),
  margin_right_mm: z.number().int().min(0).max(40),
  margin_bottom_mm: z.number().int().min(0).max(40),
  margin_left_mm: z.number().int().min(0).max(40),
  show_logo: z.boolean(),
  show_header: z.boolean(),
  show_patient_block: z.boolean(),
  show_footer: z.boolean(),
  show_doctor_info: z.boolean(),
  show_signature: z.boolean(),
  footer_text_en: z.string().max(300).nullable(),
  footer_text_ar: z.string().max(300).nullable(),
})

/** Document layout template (header, footer, margins, orientation, signature). */
export async function saveDocumentTemplate(input: z.input<typeof docTemplateSchema>): Promise<ActionResult<void>> {
  const auth = await authorize(P.templatesEdit)
  if (auth.error) return auth.error
  const parsed = docTemplateSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { document_type, expectedVersion, ...row } = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("document_templates")
    .update({ ...row, footer_text_en: row.footer_text_en?.trim() || null, footer_text_ar: row.footer_text_ar?.trim() || null })
    .eq("document_type", document_type)
    .eq("version", expectedVersion)
    .select("document_type")
    .maybeSingle()
  if (error) return dbFail("saveDocumentTemplate", error)
  if (!data) return fail("conflict")
  revalidatePath("/admin/documents")
  return ok(undefined)
}

/** Retention of generated exports (the medical record itself is never deleted). */
export async function saveDocumentRetention(days: number | null): Promise<ActionResult<void>> {
  const auth = await authorize(P.settingsManage)
  if (auth.error) return auth.error
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 36500)) return fail("validation")
  const supabase = await createClient()
  const { error } = await supabase.from("clinic_settings").update({ generated_document_retention_days: days }).eq("id", 1)
  if (error) return dbFail("saveDocumentRetention", error)
  revalidatePath("/admin/documents")
  return ok(undefined)
}
