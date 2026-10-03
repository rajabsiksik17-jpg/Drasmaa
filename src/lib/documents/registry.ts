import { P, type PermissionCode } from "@/lib/permissions"

/**
 * Every exportable document: which permission is needed to see its
 * content, which record it is generated from, how it is rendered (the
 * same print views users already know) and its paper orientation.
 */
export const DOCUMENT_TYPES = [
  "patient_summary",
  "medical_history",
  "visit_summary",
  "gynecology_visit",
  "pregnancy_summary",
  "pregnancy_followup",
  "fertility_summary",
  "oi_chart",
  "investigations",
  "appointment_summary",
  "timeline",
  "ivf_consent",
  "prescription",
  "medical_report",
  "invoice",
  "receipt",
  "insurance_claim",
  "drawing",
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export type SourceEntity =
  | "patient"
  | "visit"
  | "pregnancy_case"
  | "fertility_case"
  | "cycle"
  | "appointment"
  | "consent"
  | "prescription"
  | "report"
  | "invoice"
  | "payment"
  | "drawing"

export interface DocumentTypeConfig {
  source: SourceEntity
  /** All required (content permission + export permission). */
  permissions: PermissionCode[]
  orientation: "portrait" | "landscape"
  /** File-name part (English, filesystem safe). */
  fileLabel: string
  /** Render route for the snapshot (relative, entity id appended). */
  route: (entityId: string) => string
}

export const DOCUMENTS: Record<DocumentType, DocumentTypeConfig> = {
  patient_summary: { source: "patient", permissions: [P.patientsView], orientation: "portrait", fileLabel: "Patient_Summary", route: (id) => `/print/report/patient-summary/${id}` },
  medical_history: { source: "patient", permissions: [P.medicalView], orientation: "portrait", fileLabel: "Medical_History", route: (id) => `/print/history/${id}` },
  visit_summary: { source: "visit", permissions: [P.visitsView], orientation: "portrait", fileLabel: "Visit_Summary", route: (id) => `/print/visit/${id}` },
  gynecology_visit: { source: "visit", permissions: [P.visitsView, P.gynecologyView], orientation: "portrait", fileLabel: "Gynecology_Visit", route: (id) => `/print/visit/${id}` },
  pregnancy_summary: { source: "pregnancy_case", permissions: [P.pregnancyView], orientation: "portrait", fileLabel: "Pregnancy_Summary", route: (id) => `/print/report/pregnancy-summary/${id}` },
  pregnancy_followup: { source: "pregnancy_case", permissions: [P.pregnancyView], orientation: "landscape", fileLabel: "Pregnancy_Followup", route: (id) => `/print/pregnancy/${id}` },
  fertility_summary: { source: "fertility_case", permissions: [P.fertilityView], orientation: "portrait", fileLabel: "Fertility_Summary", route: (id) => `/print/report/fertility-summary/${id}` },
  oi_chart: { source: "cycle", permissions: [P.oiView], orientation: "landscape", fileLabel: "OI_Cycle", route: (id) => `/print/cycle/${id}` },
  investigations: { source: "patient", permissions: [P.investigationsView], orientation: "portrait", fileLabel: "Investigations", route: (id) => `/print/report/investigations/${id}` },
  appointment_summary: { source: "appointment", permissions: [P.appointmentsView], orientation: "portrait", fileLabel: "Appointment", route: (id) => `/print/report/appointment/${id}` },
  timeline: { source: "patient", permissions: [P.patientsView], orientation: "portrait", fileLabel: "Timeline", route: (id) => `/print/report/timeline/${id}` },
  ivf_consent: { source: "consent", permissions: [P.fertilityView], orientation: "portrait", fileLabel: "IVF_Consent", route: (id) => `/print/consent/${id}` },
  prescription: { source: "prescription", permissions: [P.prescriptionsView], orientation: "portrait", fileLabel: "Prescription", route: (id) => `/print/prescription/${id}` },
  medical_report: { source: "report", permissions: [P.reportsView], orientation: "portrait", fileLabel: "Medical_Report", route: (id) => `/print/medical-report/${id}` },
  invoice: { source: "invoice", permissions: [P.accountingView], orientation: "portrait", fileLabel: "Invoice", route: (id) => `/print/invoice/${id}` },
  receipt: { source: "payment", permissions: [P.accountingView], orientation: "portrait", fileLabel: "Receipt", route: (id) => `/print/receipt/${id}` },
  insurance_claim: { source: "invoice", permissions: [P.accountingView], orientation: "portrait", fileLabel: "Insurance_Claim", route: (id) => `/print/insurance-claim/${id}` },
  drawing: { source: "drawing", permissions: [P.drawingsView], orientation: "portrait", fileLabel: "Ultrasound_Drawing", route: (id) => `/print/drawing/${id}` },
}

/** Selectable sections of the patient summary (each gated by its own permission). */
export const SUMMARY_SECTIONS = [
  { key: "patient", permission: P.patientsView, default: true },
  { key: "partner", permission: P.patientsView, default: true },
  { key: "medical_history", permission: P.medicalView, default: true },
  { key: "surgical_history", permission: P.medicalView, default: true },
  { key: "allergies", permission: P.allergyView, default: true },
  { key: "family_history", permission: P.medicalView, default: true },
  { key: "medications", permission: P.medicalView, default: true },
  { key: "obstetric_history", permission: P.medicalView, default: false },
  { key: "investigations", permission: P.investigationsView, default: true },
  { key: "appointments", permission: P.appointmentsView, default: true },
  { key: "visits", permission: P.visitsView, default: false },
  { key: "pregnancy", permission: P.pregnancyView, default: false },
  { key: "fertility", permission: P.fertilityView, default: false },
  { key: "gynecology", permission: P.gynecologyView, default: false },
  { key: "treatment_plans", permission: P.visitsView, default: false },
  { key: "documents", permission: P.documentsView, default: false },
] as const
export type SummarySection = (typeof SUMMARY_SECTIONS)[number]["key"]

export const isDocumentType = (v: unknown): v is DocumentType => typeof v === "string" && (DOCUMENT_TYPES as readonly string[]).includes(v)

/**
 * {patient_name}_{document_type}_{YYYY-MM-DD}_{HH-mm}.pdf — letters of any
 * script are kept (Arabic names stay readable); characters invalid on
 * Windows/macOS/Linux and control characters are removed.
 */
export function buildFileName(patientName: string, type: DocumentType, at: { date: string; time: string }): string {
  const name =
    patientName
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‎‏‪-‮]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 80) || "Patient"
  return `${name}_${DOCUMENTS[type].fileLabel}_${at.date}_${at.time.replace(":", "-")}.pdf`
}
