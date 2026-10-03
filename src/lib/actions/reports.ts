"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { ageFromDob, clinicToday, formatDate } from "@/lib/dates"
import type { MedicalReport, ReportTemplate } from "@/types/db"

const REPORT_VARS = /\{\{\s*(patient_name|age|date|doctor_name|specialization|clinic_name|reference|dob|patient_id|country)\s*\}\}/g

/** Fills report variables from the record at creation time (the text then belongs to the report). */
function fill(text: string, vars: Record<string, string>) {
  return text.replace(REPORT_VARS, (whole, k: string) => vars[k] ?? whole)
}

const createSchema = z.object({
  patientId: z.uuid().nullable(),
  visitId: z.uuid().nullable().optional(),
  templateId: z.uuid().nullable(),
  language: z.enum(["ar", "en", "bilingual"]),
  subject: z
    .object({
      name: z.string().trim().min(2).max(200),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      age: z.number().int().min(0).max(130).nullable(),
      country: z.string().trim().max(100).nullable(),
      reference: z.string().trim().max(100).nullable(),
    })
    .optional(),
})

/**
 * New report: for a registered patient the identity comes from the record
 * (no re-typing); for anyone else it is entered here and no patient record
 * is created.
 */
export async function createReport(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.reportsCreate)
  if (auth.error) return auth.error
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path.join("."))))
  const v = parsed.data
  const supabase = await createClient()

  let subject: { name: string; dob: string | null; age: number | null; country: string | null; reference: string | null; code: string | null }
  if (v.patientId) {
    const { data: p } = await supabase.from("patients").select("full_name, dob, patient_code").eq("id", v.patientId).maybeSingle()
    if (!p) return fail("notFound")
    subject = { name: p.full_name, dob: p.dob, age: ageFromDob(p.dob), country: null, reference: null, code: p.patient_code }
  } else {
    if (!v.subject) return fail("validation", ["subject.name"])
    subject = { ...v.subject, age: v.subject.age ?? ageFromDob(v.subject.dob), code: null }
  }

  const [{ data: template }, { data: clinic }, { data: doctor }] = await Promise.all([
    v.templateId ? supabase.from("report_templates").select("*").eq("id", v.templateId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("clinic_settings").select("clinic_name_en, clinic_name_ar, main_doctor_id").eq("id", 1).single(),
    supabase
      .from("doctors")
      .select("id, display_name_en, display_name_ar, specialty")
      .eq("id", auth.session.doctor?.id ?? "00000000-0000-0000-0000-000000000000")
      .maybeSingle(),
  ])
  const t = template as ReportTemplate | null
  let doctorRow = doctor
  if (!doctorRow && clinic?.main_doctor_id) {
    doctorRow = (await supabase.from("doctors").select("id, display_name_en, display_name_ar, specialty").eq("id", clinic.main_doctor_id).maybeSingle()).data
  }
  const today = clinicToday()
  const base = {
    patient_name: subject.name,
    age: subject.age != null ? String(subject.age) : "",
    date: formatDate(today),
    dob: subject.dob ? formatDate(subject.dob) : "",
    reference: subject.reference ?? "",
    country: subject.country ?? "",
    patient_id: subject.code ?? "",
    specialization: doctorRow?.specialty ?? "",
  }
  const en = { ...base, doctor_name: doctorRow?.display_name_en ?? "", clinic_name: clinic?.clinic_name_en ?? "" }
  const ar = { ...base, doctor_name: doctorRow?.display_name_ar || doctorRow?.display_name_en || "", clinic_name: clinic?.clinic_name_ar ?? "" }
  const primaryAr = v.language === "ar"

  const { data, error } = await supabase
    .from("medical_reports")
    .insert({
      patient_id: v.patientId,
      visit_id: v.visitId ?? null,
      template_id: t?.id ?? null,
      report_type: t?.report_type ?? "custom",
      language: v.language,
      report_date: today,
      title: (primaryAr ? t?.title_ar : t?.title_en) ?? null,
      recipient: (primaryAr ? t?.recipient_ar : t?.recipient_en) ?? null,
      subject_name: subject.name,
      subject_dob: subject.dob,
      subject_age: subject.age,
      subject_country: subject.country,
      subject_reference: subject.reference,
      subject_patient_code: subject.code,
      doctor_id: doctorRow?.id ?? null,
      body_en: v.language === "ar" ? "" : fill(t?.body_en ?? "", en),
      body_ar: v.language === "en" ? "" : fill(t?.body_ar ?? "", ar),
    })
    .select("id")
    .single()
  if (error) return dbFail("createReport", error)
  revalidatePath("/reports")
  return ok({ id: data.id })
}

const saveSchema = z.object({
  id: z.uuid(),
  expectedVersion: z.number().int(),
  language: z.enum(["ar", "en", "bilingual"]),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().max(200).nullable(),
  recipient: z.string().max(300).nullable(),
  subject_name: z.string().trim().min(2).max(200),
  subject_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  subject_age: z.number().int().min(0).max(130).nullable(),
  subject_country: z.string().max(100).nullable(),
  subject_reference: z.string().max(100).nullable(),
  doctor_id: z.uuid().nullable(),
  body_en: z.string().max(30000),
  body_ar: z.string().max(30000),
  report_type: z.string().regex(/^[a-z_]+$/),
})

/** Saves the report text. A final report keeps its previous version automatically. */
export async function saveReport(input: z.input<typeof saveSchema>): Promise<ActionResult<{ version: number }>> {
  const auth = await authorize(P.reportsCreate, P.reportsEdit)
  if (auth.error) return auth.error
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { id, expectedVersion, ...row } = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("medical_reports")
    .update({ ...row, title: row.title?.trim() || null, recipient: row.recipient?.trim() || null })
    .eq("id", id)
    .eq("version", expectedVersion)
    .select("version")
    .maybeSingle()
  if (error) return dbFail("saveReport", error)
  if (!data) return fail("conflict")
  revalidatePath(`/reports/${id}`)
  return ok({ version: data.version })
}

export async function finalizeReport(id: string, expectedVersion: number): Promise<ActionResult<void>> {
  const auth = await authorize(P.reportsCreate, P.reportsEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("medical_reports")
    .update({ status: "final" })
    .eq("id", id)
    .eq("version", expectedVersion)
    .eq("status", "draft")
    .select("patient_id")
    .maybeSingle()
  if (error) return dbFail("finalizeReport", error)
  if (!data) return fail("conflict")
  revalidatePath(`/reports/${id}`)
  revalidatePath("/reports")
  if (data.patient_id) revalidatePath(`/patients/${data.patient_id}`)
  return ok(undefined)
}

export async function voidReport(id: string, reason: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.reportsDelete)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success || reason.trim().length < 3) return fail("validation", ["reason"])
  const supabase = await createClient({ auditReason: reason })
  const { error } = await supabase.from("medical_reports").update({ status: "void" }).eq("id", id)
  if (error) return dbFail("voidReport", error)
  revalidatePath(`/reports/${id}`)
  revalidatePath("/reports")
  return ok(undefined)
}

export async function duplicateReport(id: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.reportsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success) return fail("validation")
  const supabase = await createClient()
  const { data: r } = await supabase.from("medical_reports").select("*").eq("id", id).maybeSingle()
  if (!r) return fail("notFound")
  const src = r as MedicalReport
  const { data, error } = await supabase
    .from("medical_reports")
    .insert({
      patient_id: src.patient_id,
      visit_id: null,
      template_id: src.template_id,
      report_type: src.report_type,
      language: src.language,
      report_date: clinicToday(),
      title: src.title,
      recipient: src.recipient,
      subject_name: src.subject_name,
      subject_dob: src.subject_dob,
      subject_age: src.subject_age,
      subject_country: src.subject_country,
      subject_reference: src.subject_reference,
      subject_patient_code: src.subject_patient_code,
      doctor_id: src.doctor_id,
      body_en: src.body_en,
      body_ar: src.body_ar,
    })
    .select("id")
    .single()
  if (error) return dbFail("duplicateReport", error)
  revalidatePath("/reports")
  return ok({ id: data.id })
}

/** Attach a standalone report to the (now registered) patient — once, no duplicate. */
export async function linkReportToPatient(id: string, patientId: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.reportsEdit)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const { data: p } = await supabase.from("patients").select("patient_code").eq("id", patientId).maybeSingle()
  if (!p) return fail("notFound")
  const { data, error } = await supabase
    .from("medical_reports")
    .update({ patient_id: patientId, subject_patient_code: p.patient_code })
    .eq("id", id)
    .is("patient_id", null)
    .select("id")
    .maybeSingle()
  if (error) return dbFail("linkReportToPatient", error)
  if (!data) return fail("conflict")
  revalidatePath(`/reports/${id}`)
  revalidatePath(`/patients/${patientId}`)
  return ok(undefined)
}

const templateSchema = z.object({
  id: z.uuid().optional(),
  report_type: z.enum(["general", "gynecology", "fertility", "pregnancy", "opinion", "referral", "certificate", "international", "followup", "custom"]),
  name_en: z.string().trim().min(1).max(160),
  name_ar: z.string().trim().min(1).max(160),
  title_en: z.string().max(200).nullable(),
  title_ar: z.string().max(200).nullable(),
  recipient_en: z.string().max(300).nullable(),
  recipient_ar: z.string().max(300).nullable(),
  body_en: z.string().max(30000),
  body_ar: z.string().max(30000),
  active: z.boolean(),
})

export async function saveReportTemplate(input: z.input<typeof templateSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.reportsEdit)
  if (auth.error) return auth.error
  const parsed = templateSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => String(i.path[0])))
  const { id, ...row } = parsed.data
  const supabase = await createClient()
  const { data, error } = id
    ? await supabase.from("report_templates").update(row).eq("id", id).select("id").single()
    : await supabase.from("report_templates").insert({ ...row, is_system: false, sort_order: 200 }).select("id").single()
  if (error) return dbFail("saveReportTemplate", error)
  revalidatePath("/admin/report-templates")
  return ok({ id: data.id })
}
