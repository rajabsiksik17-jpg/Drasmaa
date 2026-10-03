"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize, hasPermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { limit } from "@/lib/security/rate-limit"
import { isServiceRoleConfigured } from "@/lib/security/events"
import { clinicInfo, isValidEmail, sendEmail } from "@/lib/email/send"
import { firstName, sanitizeSubject, type TemplateVars } from "@/lib/messaging/templates"
import { appointmentVariables, documentVariables, type AppointmentPayload } from "@/lib/messaging/variables"
import { normalizeWhatsAppNumber, whatsappLink } from "@/lib/messaging/whatsapp"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"
import type { MessageTemplate } from "@/lib/actions/templates"

const contextSchema = z.object({
  /** null for documents about a person who is not a registered patient (standalone reports). */
  patientId: z.uuid().nullable(),
  appointmentId: z.uuid().nullable().optional(),
  generatedDocumentId: z.uuid().nullable().optional(),
})

export interface MessageContext {
  patient: {
    id: string
    name: string
    code: string
    phone: string | null
    whatsappPhone: string | null
    email: string | null
    language: "ar" | "en"
    husbandName: string | null
    husbandPhone: string | null
  }
  /** Variables per language, computed on the server from authorized data. */
  variables: { ar: TemplateVars; en: TemplateVars }
  templates: Pick<MessageTemplate, "id" | "channel" | "category" | "purpose" | "name_en" | "name_ar" | "subject_en" | "subject_ar" | "body_en" | "body_ar" | "default_language" | "version">[]
  whatsapp: { enabled: boolean; countryCode: string; openMode: "auto" | "web" | "app" }
  emailConfigured: boolean
  appointment: { id: string; visitType: string; status: string } | null
  document: { id: string; fileName: string; documentType: string; title: string } | null
  can: { whatsapp: boolean; email: boolean }
}

type Supa = Awaited<ReturnType<typeof createClient>>

type Subject = {
  patient: { id: string | null; full_name: string; patient_code: string; phone: string | null; whatsapp_phone: string | null; email: string | null; preferred_language: string | null }
  husband: { full_name: string | null; phone: string | null } | null
}

/** The registered patient, or — for a standalone report document — the report's subject. */
async function loadSubject(supabase: Supa, patientId: string | null, documentId?: string | null): Promise<Subject | null> {
  if (patientId) return loadPatient(supabase, patientId)
  if (!documentId) return null
  const { data } = await supabase
    .from("generated_documents")
    .select("report:medical_reports(subject_name, report_number, language)")
    .eq("id", documentId)
    .is("patient_id", null)
    .maybeSingle()
  const r = data?.report as unknown as { subject_name: string; report_number: string; language: string } | null
  if (!r) return null
  return {
    patient: { id: null, full_name: r.subject_name, patient_code: r.report_number, phone: null, whatsapp_phone: null, email: null, preferred_language: r.language === "ar" ? "ar" : "en" },
    husband: null,
  }
}

async function loadPatient(supabase: Supa, patientId: string) {
  const [{ data: patient }, { data: husband }] = await Promise.all([
    supabase.from("patients").select("id, full_name, patient_code, phone, whatsapp_phone, email, preferred_language").eq("id", patientId).maybeSingle(),
    supabase.from("patient_husbands").select("full_name, phone").eq("patient_id", patientId).maybeSingle(),
  ])
  return patient ? { patient, husband } : null
}

/** Everything the message composer needs — only what the user may see. */
export async function getMessageContext(input: z.input<typeof contextSchema>): Promise<ActionResult<MessageContext>> {
  const auth = await authorize(P.messagesSend)
  if (auth.error) return auth.error
  const parsed = contextSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const { patientId, appointmentId, generatedDocumentId } = parsed.data
  const supabase = await createClient()
  if (!patientId && (appointmentId || !generatedDocumentId)) return fail("validation")
  const loaded = await loadSubject(supabase, patientId, generatedDocumentId)
  if (!loaded) return fail("notFound")
  const { patient, husband } = loaded

  let payload: AppointmentPayload | null = null
  let appointment: MessageContext["appointment"] = null
  if (appointmentId) {
    const { data: a } = await supabase
      .from("appointments")
      .select("id, patient_id, visit_type, status, scheduled_at, doctor:doctors(display_name_en, display_name_ar)")
      .eq("id", appointmentId)
      .eq("patient_id", patientId)
      .maybeSingle()
    if (!a) return fail("notFound")
    const doctor = a.doctor as unknown as { display_name_en: string; display_name_ar: string | null } | null
    const { data: opt } = await supabase
      .from("dropdown_options")
      .select("label_en, label_ar")
      .eq("category", "appointment_type")
      .eq("value", a.visit_type)
      .maybeSingle()
    payload = {
      patient_name: patient.full_name,
      patient_code: patient.patient_code,
      scheduled_at: a.scheduled_at,
      doctor_name_en: doctor?.display_name_en,
      doctor_name_ar: doctor?.display_name_ar ?? doctor?.display_name_en,
      visit_type_en: opt?.label_en ?? a.visit_type,
      visit_type_ar: opt?.label_ar ?? a.visit_type,
    }
    appointment = { id: a.id, visitType: a.visit_type, status: a.status }
  }

  let document: MessageContext["document"] = null
  let docVars: { en: TemplateVars; ar: TemplateVars } = { en: {}, ar: {} }
  if (generatedDocumentId) {
    const { data: g } = await supabase
      .from("generated_documents")
      .select("id, patient_id, file_name, document_type, title, generated_at, status, template:document_templates(name_en, name_ar)")
      .eq("id", generatedDocumentId)
      .maybeSingle()
    if (!g || g.status !== "generated" || g.patient_id !== patientId) return fail("notFound")
    const tpl = g.template as unknown as { name_en: string; name_ar: string } | null
    document = { id: g.id, fileName: g.file_name, documentType: g.document_type, title: g.title }
    docVars = {
      en: documentVariables(tpl?.name_en ?? g.title, g.generated_at),
      ar: documentVariables(tpl?.name_ar ?? g.title, g.generated_at),
    }
  }

  // Treating doctor for templates without an appointment.
  let doctorEn = payload?.doctor_name_en ?? ""
  let doctorAr = payload?.doctor_name_ar ?? ""
  if (!payload && patientId) {
    const { data: p2 } = await supabase.from("patients").select("doctor:doctors!patients_assigned_doctor_id_fkey(display_name_en, display_name_ar)").eq("id", patientId).maybeSingle()
    const d = p2?.doctor as unknown as { display_name_en: string; display_name_ar: string | null } | null
    doctorEn = d?.display_name_en ?? ""
    doctorAr = d?.display_name_ar ?? doctorEn
  }

  const [clinicEn, clinicAr] = await Promise.all([clinicInfo("en"), clinicInfo("ar")])
  const base = (lang: "ar" | "en", clinic: typeof clinicEn): TemplateVars => ({
    patient_name: patient.full_name,
    patient_first_name: firstName(patient.full_name),
    patient_id: patient.patient_code,
    patient_phone: patient.phone ?? "",
    doctor_name: lang === "ar" ? doctorAr : doctorEn,
    clinic_name: clinic.name,
    clinic_phone: clinic.phone,
    clinic_address: clinic.address,
    ...(payload ? appointmentVariables(payload, lang) : {}),
    ...docVars[lang],
  })

  const [{ data: templates }, { data: settings }] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id, channel, category, purpose, name_en, name_ar, subject_en, subject_ar, body_en, body_ar, default_language, version")
      .eq("active", true)
      .is("archived_at", null)
      .neq("category", "security")
      .order("sort_order"),
    supabase.from("clinic_settings").select("whatsapp_enabled, whatsapp_country_code, whatsapp_open_mode").eq("id", 1).single(),
  ])

  let emailConfigured = false
  if (isServiceRoleConfigured()) {
    const { data: acc } = await createAdminClient().from("email_accounts").select("smtp_status").eq("is_default", true).maybeSingle()
    emailConfigured = !!acc && acc.smtp_status !== "failed"
  }

  return ok({
    patient: {
      id: patient.id ?? "",
      name: patient.full_name,
      code: patient.patient_code,
      phone: patient.phone,
      whatsappPhone: patient.whatsapp_phone,
      email: patient.email,
      language: patient.preferred_language === "en" ? "en" : "ar",
      husbandName: husband?.full_name ?? null,
      husbandPhone: husband?.phone ?? null,
    },
    variables: { ar: base("ar", clinicAr), en: base("en", clinicEn) },
    templates: (templates ?? []) as MessageContext["templates"],
    whatsapp: {
      enabled: settings?.whatsapp_enabled ?? true,
      countryCode: settings?.whatsapp_country_code ?? "962",
      openMode: (settings?.whatsapp_open_mode as "auto" | "web" | "app") ?? "auto",
    },
    emailConfigured,
    appointment,
    document,
    can: {
      whatsapp: hasPermission(auth.session, P.messagesPrepareWhatsapp) && (!document || hasPermission(auth.session, P.documentsShare)),
      email: hasPermission(auth.session, P.messagesSendEmail) && (!document || hasPermission(auth.session, P.documentsShare)),
    },
  })
}

const recipientSchema = z.enum(["patient", "husband", "custom"])
const baseSend = z.object({
  patientId: z.uuid().nullable(),
  appointmentId: z.uuid().nullable().optional(),
  generatedDocumentId: z.uuid().nullable().optional(),
  templateId: z.uuid().nullable().optional(),
  purpose: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60).default("custom"),
  language: z.enum(["ar", "en"]),
  recipientType: recipientSchema,
  body: z.string().trim().min(1).max(4000),
})

async function templateVersion(supabase: Supa, templateId: string | null | undefined) {
  if (!templateId) return null
  const { data } = await supabase.from("message_templates").select("id, version").eq("id", templateId).maybeSingle()
  return data
}

async function verifyLinks(supabase: Supa, patientId: string | null, appointmentId?: string | null, documentId?: string | null) {
  if (!patientId) {
    if (appointmentId || !documentId) return false
    const { data } = await supabase.from("generated_documents").select("id").eq("id", documentId).is("patient_id", null).eq("status", "generated").maybeSingle()
    return !!data
  }
  if (appointmentId) {
    const { data } = await supabase.from("appointments").select("id").eq("id", appointmentId).eq("patient_id", patientId).maybeSingle()
    if (!data) return false
  }
  if (documentId) {
    const { data } = await supabase
      .from("generated_documents")
      .select("id")
      .eq("id", documentId)
      .eq("patient_id", patientId)
      .eq("status", "generated")
      .maybeSingle()
    if (!data) return false
  }
  return true
}

const whatsappSchema = baseSend.extend({ customNumber: z.string().max(30).optional() })

/**
 * Prepares (never sends) a WhatsApp message: validates the recipient number
 * on the server and records "prepared" in the communication history.
 */
export async function prepareWhatsapp(
  input: z.input<typeof whatsappSchema>,
): Promise<ActionResult<{ logId: string; number: string; links: { web: string; app: string; universal: string } }>> {
  const auth = await authorize(P.messagesPrepareWhatsapp)
  if (auth.error) return auth.error
  const parsed = whatsappSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  if (v.generatedDocumentId && !hasPermission(auth.session, P.documentsShare)) return fail("forbidden")
  if (!(await limit("emailSendPerUser", `wa:${auth.session.userId}`))) return fail("rateLimited")

  const supabase = await createClient()
  const loaded = await loadSubject(supabase, v.patientId, v.generatedDocumentId)
  if (!loaded) return fail("notFound")
  if (!(await verifyLinks(supabase, v.patientId, v.appointmentId, v.generatedDocumentId))) return fail("notFound")
  const { data: settings } = await supabase.from("clinic_settings").select("whatsapp_enabled, whatsapp_country_code").eq("id", 1).single()
  if (settings && !settings.whatsapp_enabled) return fail("forbidden")

  const raw =
    v.recipientType === "patient"
      ? (loaded.patient.whatsapp_phone ?? loaded.patient.phone)
      : v.recipientType === "husband"
        ? loaded.husband?.phone
        : v.customNumber
  const normalized = normalizeWhatsAppNumber(raw, settings?.whatsapp_country_code ?? "962")
  if (!normalized.ok) return fail("invalidPhone")

  const tpl = await templateVersion(supabase, v.templateId)
  const { data: log, error } = await supabase
    .from("communication_logs")
    .insert({
      patient_id: v.patientId,
      appointment_id: v.appointmentId ?? null,
      generated_document_id: v.generatedDocumentId ?? null,
      channel: "whatsapp",
      purpose: v.purpose,
      template_id: tpl?.id ?? null,
      template_version: tpl?.version ?? null,
      recipient_type: v.recipientType,
      recipient: `+${normalized.number}`,
      language: v.language,
      body: v.body,
      status: "prepared",
      performed_by: auth.session.userId,
    })
    .select("id")
    .single()
  if (error) return dbFail("prepareWhatsapp", error)
  if (v.generatedDocumentId) {
    await supabase.rpc("log_document_access", {
      p_generated: v.generatedDocumentId,
      p_document: null,
      p_action: "whatsapp_prepared",
      p_channel: "whatsapp",
      p_recipient: `+${normalized.number}`,
    })
  }
  if (v.patientId) revalidatePath(`/patients/${v.patientId}`)
  return ok({
    logId: log.id,
    number: normalized.number,
    links: {
      web: whatsappLink(normalized.number, v.body, "web"),
      app: whatsappLink(normalized.number, v.body, "app"),
      universal: whatsappLink(normalized.number, v.body, "universal"),
    },
  })
}

/** The user opened WhatsApp with the prepared message ("Opened", not "Delivered"). */
export async function markWhatsappOpened(logId: string): Promise<ActionResult<void>> {
  const auth = await authorize(P.messagesPrepareWhatsapp)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(logId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("communication_logs")
    .update({ status: "opened" })
    .eq("id", logId)
    .eq("performed_by", auth.session.userId)
    .select("generated_document_id, recipient")
    .maybeSingle()
  if (error) return dbFail("markWhatsappOpened", error)
  if (data?.generated_document_id) {
    await supabase.rpc("log_document_access", {
      p_generated: data.generated_document_id,
      p_document: null,
      p_action: "whatsapp_opened",
      p_channel: "whatsapp",
      p_recipient: data.recipient,
    })
  }
  return ok(undefined)
}

const emailSchema = baseSend.extend({
  to: z.string().max(320).optional(),
  subject: z.string().trim().min(1).max(200),
})

/**
 * Sends an email to the patient (or a validated custom address) through
 * the clinic SMTP account. Status is "sent" only when SMTP accepted it.
 */
export async function sendPatientEmail(input: z.input<typeof emailSchema>): Promise<ActionResult<{ logId: string }>> {
  const auth = await authorize(P.messagesSendEmail)
  if (auth.error) return auth.error
  const parsed = emailSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const v = parsed.data
  if (v.recipientType === "husband") return fail("validation")
  if (v.generatedDocumentId && !hasPermission(auth.session, P.documentsShare)) return fail("forbidden")
  if (!isServiceRoleConfigured()) return fail("serviceKeyMissing")
  if (!(await limit("emailSendPerUser", auth.session.userId))) return fail("rateLimited")

  const supabase = await createClient()
  const loaded = await loadSubject(supabase, v.patientId, v.generatedDocumentId)
  if (!loaded) return fail("notFound")
  if (!(await verifyLinks(supabase, v.patientId, v.appointmentId, v.generatedDocumentId))) return fail("notFound")
  const to = (v.recipientType === "patient" ? loaded.patient.email : v.to)?.trim().toLowerCase()
  if (!isValidEmail(to)) return fail("invalidEmail")

  let attachment: { filename: string; content: Buffer; contentType: string } | undefined
  if (v.generatedDocumentId) {
    const { data: doc } = await supabase
      .from("generated_documents")
      .select("storage_path, file_name")
      .eq("id", v.generatedDocumentId)
      .single()
    const { data: blob, error: dlError } = await supabase.storage.from(DOCUMENTS_BUCKET).download(doc!.storage_path)
    if (dlError || !blob) return fail("notFound")
    attachment = { filename: doc!.file_name, content: Buffer.from(await blob.arrayBuffer()), contentType: "application/pdf" }
  }

  const subject = sanitizeSubject(v.subject)
  const tpl = await templateVersion(supabase, v.templateId)
  const { data: log, error } = await supabase
    .from("communication_logs")
    .insert({
      patient_id: v.patientId,
      appointment_id: v.appointmentId ?? null,
      generated_document_id: v.generatedDocumentId ?? null,
      channel: "email",
      purpose: v.purpose,
      template_id: tpl?.id ?? null,
      template_version: tpl?.version ?? null,
      recipient_type: v.recipientType,
      recipient: to,
      language: v.language,
      subject,
      body: v.body,
      status: "queued",
      performed_by: auth.session.userId,
    })
    .select("id")
    .single()
  if (error) return dbFail("sendPatientEmail", error)

  const clinic = await clinicInfo(v.language)
  const sent = await sendEmail({ to, subject, text: v.body, language: v.language, attachments: attachment ? [attachment] : undefined }, clinic.name)
  const admin = createAdminClient()
  await admin
    .from("communication_logs")
    .update(sent.ok ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed", error_code: sent.code })
    .eq("id", log.id)
  if (v.generatedDocumentId) {
    await supabase.rpc("log_document_access", {
      p_generated: v.generatedDocumentId,
      p_document: null,
      p_action: sent.ok ? "email_sent" : "email_failed",
      p_channel: "email",
      p_recipient: to,
      p_result: sent.ok ? "ok" : "failed",
    })
  }
  if (v.patientId) revalidatePath(`/patients/${v.patientId}`)
  if (!sent.ok) return fail(sent.code === "not_configured" ? "emailNotConfigured" : "emailFailed", undefined, sent.code)
  return ok({ logId: log.id })
}

export interface CommunicationEntry {
  id: string
  created_at: string
  channel: "whatsapp" | "email" | "in_app" | "system"
  purpose: string
  status: string
  recipient: string
  recipient_type: string | null
  subject: string | null
  body: string | null
  language: string | null
  automated: boolean
  error_code: string | null
  appointment_id: string | null
  generated_document_id: string | null
  opened_at: string | null
  sent_at: string | null
  template: { name_en: string; name_ar: string } | null
  performer: { full_name: string } | null
}

export async function listCommunications(patientId: string, before?: string): Promise<ActionResult<CommunicationEntry[]>> {
  const auth = await authorize(P.patientsView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  let q = supabase
    .from("communication_logs")
    .select(
      "id, created_at, channel, purpose, status, recipient, recipient_type, subject, body, language, automated, error_code, appointment_id, generated_document_id, opened_at, sent_at, template:message_templates(name_en, name_ar), performer:profiles!communication_logs_performed_by_fkey(full_name)",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(30)
  if (before) q = q.lt("created_at", before)
  const { data, error } = await q
  if (error) return dbFail("listCommunications", error)
  return ok((data ?? []) as unknown as CommunicationEntry[])
}
