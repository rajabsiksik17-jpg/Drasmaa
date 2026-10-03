// Template rendering shared by the server (sending) and the browser
// (live preview). Variables use {{name}}; unknown names are left visible
// so a mistyped variable is noticed in the preview instead of vanishing.

export const TEMPLATE_VARIABLES = [
  "patient_name",
  "patient_first_name",
  "patient_id",
  "patient_phone",
  "case_number",
  "doctor_name",
  "clinic_name",
  "clinic_phone",
  "clinic_address",
  "appointment_date",
  "appointment_time",
  "appointment_type",
  "visit_type",
  "followup_date",
  "document_type",
  "document_date",
  "user_name",
  "user_email",
  "login_time",
  "device",
  "otp_code",
  "otp_minutes",
  "notification_title",
  "notification_message",
  "link",
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]
export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>

/** Variables offered per template category in the editor. */
export const VARIABLE_GROUPS: Record<string, TemplateVariable[]> = {
  patient: ["patient_name", "patient_first_name", "patient_id", "patient_phone", "case_number"],
  clinic: ["clinic_name", "clinic_phone", "clinic_address", "doctor_name"],
  appointment: ["appointment_date", "appointment_time", "appointment_type", "visit_type", "followup_date"],
  document: ["document_type", "document_date"],
  security: ["user_name", "user_email", "login_time", "device", "otp_code", "otp_minutes", "notification_title", "notification_message", "link"],
}

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(VAR_RE, (whole, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return whole
    const value = vars[name as TemplateVariable]
    return value == null ? "" : String(value)
  })
}

/** Variables present in a text that the system does not know. */
export function unknownVariables(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(VAR_RE)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(m[1])) out.add(m[1])
  }
  return [...out]
}

/** Email subjects: single line, bounded (no header injection). */
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 200)
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? ""
}

/** Realistic sample data for previews in the template editor. */
export function sampleVariables(locale: "ar" | "en", clinic: { name: string; phone: string; address: string }): TemplateVars {
  const ar = locale === "ar"
  return {
    patient_name: ar ? "سارة أحمد" : "Sara Ahmad",
    patient_first_name: ar ? "سارة" : "Sara",
    patient_id: "PAT-000123",
    patient_phone: "0791234567",
    case_number: "2",
    doctor_name: ar ? "أحمد خالد" : "Ahmad Khaled",
    clinic_name: clinic.name,
    clinic_phone: clinic.phone || "06 555 0000",
    clinic_address: clinic.address,
    appointment_date: "10/10/2026",
    appointment_time: ar ? "05:00 م" : "05:00 PM",
    appointment_type: ar ? "استشارة خصوبة" : "Fertility consultation",
    visit_type: ar ? "استشارة خصوبة" : "Fertility consultation",
    followup_date: "24/10/2026",
    document_type: ar ? "متابعة الحمل" : "Pregnancy Follow-up",
    document_date: "03/10/2026",
    user_name: ar ? "د. أحمد" : "Dr. Ahmad",
    user_email: "doctor@example.com",
    login_time: "03/10/2026 19:45",
    device: "Chrome / Windows",
    otp_code: "482915",
    otp_minutes: "5",
    notification_title: ar ? "تسجيل دخول جديد" : "New login detected",
    notification_message: "Chrome / Windows",
    link: "https://clinic.example.com/settings/security",
  }
}
