// Row types mirroring supabase/migrations. Kept hand-written so the app
// compiles without a running database; regenerate-able with
// `supabase gen types typescript` once a project is linked.

export interface Versioned {
  version: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type YesNo = boolean | null
export type BloodGroup = "A" | "B" | "AB" | "O"
export type Rh = "+" | "-"
export type PaymentMethod = "cash" | "insurance"

export interface Role extends Versioned {
  id: string
  code: string
  name_en: string
  name_ar: string
  is_system: boolean
  active: boolean
  sort_order: number
  /** Maximum discount percent this role may apply (null = unlimited). */
  max_discount_percent: number | null
}

export interface Permission {
  code: string
  group_code: string
  description_en: string
  description_ar: string
  sort_order: number
}

export interface Department extends Versioned {
  id: string
  code: string
  name_en: string
  name_ar: string
  active: boolean
  sort_order: number
}

export interface Profile extends Versioned {
  id: string
  email: string | null
  full_name: string
  full_name_ar: string | null
  phone: string | null
  role_id: string | null
  department_id: string | null
  locale: "en" | "ar"
  preferences: UserPreferences
  active: boolean
}

export interface UserPreferences {
  density?: "comfortable" | "compact"
  dashboard?: "default" | "queue_first"
  notify_checkin?: boolean
  notify_reminders?: boolean
  /** Soft chime for queue alerts (doctor request, bill ready, patient waiting). Off by default. */
  sound_alerts?: boolean
}

export interface Doctor extends Versioned {
  id: string
  profile_id: string | null
  display_name_en: string
  display_name_ar: string | null
  department_id: string | null
  specialty: string | null
  color: string | null
  active: boolean
  sort_order: number
  title_en?: string | null
  title_ar?: string | null
  phone?: string | null
  email?: string | null
  license_number?: string | null
  photo_path?: string | null
  signature_path?: string | null
}

export interface DoctorWorkingHours {
  id: string
  doctor_id: string
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  start_time: string
  end_time: string
}

export interface InsuranceCompany extends Versioned {
  id: string
  code: string | null
  name_en: string
  name_ar: string
  active: boolean
  sort_order: number
}

export interface DropdownOption extends Versioned {
  id: string
  category: string
  value: string
  label_en: string
  label_ar: string
  active: boolean
  sort_order: number
}

export interface ClinicSettings extends Versioned {
  id: 1
  clinic_name_en: string
  clinic_name_ar: string
  phone: string | null
  email: string | null
  address_en: string | null
  address_ar: string | null
  logo_path: string | null
  timezone: string
  default_language: "en" | "ar"
  appointment_slot_minutes: number
  working_hours_start: string
  working_hours_end: string
  doctor_access_scope: "all" | "department" | "assigned"
  receptionist_history_days: number
  max_upload_mb: number
  mobile: string | null
  whatsapp: string | null
  website: string | null
  city_en: string | null
  city_ar: string | null
  country_en: string | null
  country_ar: string | null
  location_text: string | null
  maps_url: string | null
  license_text: string | null
  secondary_logo_path: string | null
  main_doctor_id: string | null
  header_text_en: string | null
  header_text_ar: string | null
  footer_text_en: string | null
  footer_text_ar: string | null
  report_footer_en: string | null
  report_footer_ar: string | null
  prescription_footer_en: string | null
  prescription_footer_ar: string | null
  invoice_footer_en: string | null
  invoice_footer_ar: string | null
  receipt_footer_en: string | null
  receipt_footer_ar: string | null
  currency: string
  currency_decimals: number
  invoice_prefix: string
  receipt_prefix: string
  report_prefix: string
  prescription_prefix: string
  collect_payment_before_consultation: boolean
  enforce_working_hours: boolean
  working_days: number[]
  payment_methods: ("cash" | "card" | "transfer" | "other")[]
}

export interface Patient extends Versioned {
  id: string
  patient_code: string
  full_name: string
  dob: string | null
  occupation: string | null
  phone: string | null
  address: string | null
  marriage_date: string | null
  blood_group: BloodGroup | null
  rh: Rh | null
  payment_method: PaymentMethod
  insurance_company_id: string | null
  status: "active" | "archived"
  assigned_doctor_id: string | null
  email: string | null
  whatsapp_phone: string | null
  preferred_language: "ar" | "en"
}

export interface PatientHusband extends Versioned {
  patient_id: string
  full_name: string | null
  dob: string | null
  occupation: string | null
  phone: string | null
  blood_group: BloodGroup | null
  rh: Rh | null
}

export interface PatientMedicalHistory extends Versioned {
  patient_id: string
  ht: YesNo
  dm: YesNo
  hypothyroidism: YesNo
  notes: string | null
}

export interface PatientNotesRow extends Versioned {
  patient_id: string
  notes: string | null
}

export interface PatientAllergy extends Versioned {
  patient_id: string
  allergy: string | null
}

export interface PatientFamilyHistory extends Versioned {
  patient_id: string
  dm: YesNo
  ht: YesNo
  thrombosis: YesNo
  cancer: YesNo
  notes: string | null
}

export interface PatientMenstrualHistory extends Versioned {
  patient_id: string
  menarche_age: number | null
  regular_cycle: YesNo
  period_duration: number | null
  cycle_frequency: number | null
  amount: string | null
  dysmenorrhea: string | null
  pms: string | null
  lmp: string | null
  notes: string | null
}

export interface PatientObstetricHistory extends Versioned {
  patient_id: string
  gravida: number | null
  para: number | null
  full_term: number | null
  premature: number | null
  abortions: number | null
  living_male: number | null
  living_female: number | null
  normal_deliveries: number | null
  c_sections: number | null
  miscarriages: number | null
  miscarriages_first_trimester: number | null
  miscarriages_second_trimester: number | null
  last_delivery_date: string | null
  last_delivery_type: string | null
  dns: YesNo
  anc: YesNo
  anc_dm: YesNo
  anc_ht: YesNo
  anc_pph: YesNo
  anc_abh: YesNo
  anc_notes: string | null
  ppc: string | null
  notes: string | null
}

export type AppointmentStatus =
  | "scheduled"
  | "checked_in"
  | "with_doctor"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled"

export interface Appointment extends Versioned {
  id: string
  patient_id: string
  doctor_id: string
  department_id: string
  visit_type: string
  scheduled_at: string
  duration_minutes: number
  ends_at: string
  status: AppointmentStatus
  notes: string | null
  payment_method: PaymentMethod | null
  insurance_company_id: string | null
  checked_in_at: string | null
  with_doctor_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  rescheduled_from_id: string | null
  source_visit_id: string | null
  service_id: string | null
  no_charge: boolean
  outside_working_hours: boolean
}

export interface AppointmentWithRefs extends Appointment {
  patient: Pick<Patient, "id" | "full_name" | "patient_code" | "phone" | "dob"> | null
  doctor: Pick<Doctor, "id" | "display_name_en" | "display_name_ar" | "color"> | null
  department: Pick<Department, "id" | "code" | "name_en" | "name_ar"> | null
}

export const NOTIFICATION_TYPES = [
  "appointment_created",
  "appointment_approaching",
  "appointment_reminder",
  "appointment_cancelled",
  "appointment_rescheduled",
  "patient_checked_in",
  "patient_requested",
  "bill_ready",
  "appointment_missed",
  "whatsapp_reminder_ready",
  "patient_registered",
  "patient_assigned",
  "pregnancy_followup_due",
  "fertility_followup_due",
  "investigation_uploaded",
  "user_created",
  "user_status_changed",
  "permission_changed",
  "doctor_added",
  "doctor_removed",
  "config_changed",
  "new_login",
  "otp_verified",
  "login_failed",
  "session_revoked",
  "password_changed",
  "security_config_changed",
  "email_failure",
  "system",
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]
export type NotificationCategory = "appointments" | "patients" | "medical" | "system" | "security" | "admin"
export type NotificationPriority = "low" | "normal" | "high" | "critical"

export interface AppNotification {
  id: string
  recipient_id: string
  type: NotificationType
  title: string
  message: string | null
  data: {
    appointment_id?: string
    patient_id?: string
    patient_name?: string
    patient_code?: string
    scheduled_at?: string
    doctor_name_en?: string
    doctor_name_ar?: string
    visit_type?: string
    visit_type_en?: string
    visit_type_ar?: string
    offset_minutes?: number
    browser?: string
    os?: string
    [key: string]: unknown
  }
  category: NotificationCategory
  priority: NotificationPriority
  link: string | null
  entity_type: string | null
  entity_id: string | null
  patient_id: string | null
  read_at: string | null
  voided_at: string | null
  created_at: string
}

export type VisitType = "pregnancy" | "fertility" | "gynecology"
export type VisitStatus = "draft" | "in_progress" | "completed" | "cancelled"

export interface Visit extends Versioned {
  id: string
  patient_id: string
  doctor_id: string | null
  appointment_id: string | null
  encounter_id?: string | null
  department_id: string | null
  visit_type: VisitType
  status: VisitStatus
  form_code: string
  form_version: number
  visit_date: string
  patient_age_years: number | null
  fertility_case_id: string | null
  pregnancy_case_id: string | null
  started_at: string
  completed_at: string | null
  completed_by: string | null
  cancel_reason: string | null
}

export interface VisitClinical extends Versioned {
  visit_id: string
  chief_complaint: string | null
  present_history: string | null
  examination: string | null
  lmp: string | null
  edd: string | null
  gravida: number | null
  para: number | null
  imported_at: string | null
}

export interface GynecologyVisit extends Versioned {
  visit_id: string
  complaint: string | null
  irregular_cycle: YesNo
  lap: YesNo
  vaginitis: YesNo
  symptom_notes: string | null
  ultrasound_template: string
  ultrasound_notes: string | null
  plan: string | null
}

export interface DrawingStroke {
  id: string
  tool: "pen" | "eraser" | "spray"
  color: string
  size: number
  points: number[]
}

export interface UltrasoundAnnotation extends Versioned {
  id: string
  patient_id: string
  visit_id: string
  template_key: string
  strokes: DrawingStroke[]
  width: number
  height: number
}

export type FertilityPlan = "oi" | "iui" | "ivf"

export interface FertilityCase extends Versioned {
  id: string
  patient_id: string
  case_number: number
  status: "active" | "closed"
  infertility_type: "primary" | "secondary" | null
  duration_years: number | null
  notes: string | null
  opened_at: string
  closed_at: string | null
}

export interface FertilityVisit extends Versioned {
  visit_id: string
  fertility_case_id: string
  causes_of_infertility: string | null
  notes: string | null
  plan_primary: FertilityPlan | null
  plan_secondary: FertilityPlan | null
  plan_notes: string | null
  ivf_consent_notes: string | null
  imported_from_visit_id: string | null
}

export interface FertilityHusbandData extends Versioned {
  visit_id: string
  fertility_case_id: string
  count: string | null
  motility: string | null
  morphology: string | null
  viscosity: string | null
  wbc: string | null
  notes: string | null
}

export interface FertilityWifeData extends Versioned {
  visit_id: string
  fertility_case_id: string
  hormonal_profile: string | null
  hsg_result: "normal" | "abnormal" | null
  hsg_notes: string | null
  us: string | null
  us_notes: string | null
  afc: number | null
  uterus: string | null
  et: string | null
  notes: string | null
}

export interface PregnancyCase extends Versioned {
  id: string
  patient_id: string
  case_number: number
  status: "active" | "closed"
  outcome: string | null
  lmp: string | null
  edd: string | null
  gravida: number | null
  para: number | null
  history: string | null
  opened_at: string
  closed_at: string | null
}

export interface PregnancyFollowup extends Versioned {
  id: string
  pregnancy_case_id: string
  visit_id: string | null
  visit_no: number
  followup_date: string
  weight_kg: number | null
  bp_systolic: number | null
  bp_diastolic: number | null
  complaint: string | null
  ultrasound: string | null
  lab: string | null
  plan: string | null
}

export interface InvestigationType {
  code: string
  name_en: string
  name_ar: string
  unit: string | null
  contexts: string[]
  active: boolean
  sort_order: number
}

export interface Investigation extends Versioned {
  id: string
  patient_id: string
  visit_id: string | null
  type_code: string
  status: "requested" | "performed" | "cancelled"
  requested_on: string
  performed_on: string | null
  notes: string | null
}

export interface InvestigationResult extends Versioned {
  id: string
  patient_id: string
  investigation_id: string | null
  visit_id: string | null
  type_code: string
  value_numeric: number | null
  value_text: string | null
  unit: string | null
  result_date: string
  document_id: string | null
  notes: string | null
}

export const DOCUMENT_CATEGORIES = ["ultrasound", "lab", "imaging", "investigation", "previous_report", "referral", "medical", "identity", "sfa", "ivf_consent", "other"] as const
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]

export interface PatientDocument extends Versioned {
  id: string
  patient_id: string
  visit_id: string | null
  fertility_case_id: string | null
  pregnancy_case_id: string | null
  cycle_id: string | null
  category: DocumentCategory
  title: string | null
  file_name: string
  mime_type: string
  size_bytes: number
  storage_path: string
  status: "active" | "archived"
  notes: string | null
  uploaded_by: string | null
  uploaded_at: string
  document_date?: string | null
  tags?: string[]
  investigation_id?: string | null
}

export interface IvfConsent extends Versioned {
  id: string
  patient_id: string
  fertility_case_id: string
  visit_id: string | null
  technique: "classic" | "icsi" | null
  surplus_embryos: "freeze" | "discard" | null
  genetic_testing: boolean
  consent_date: string | null
  document_id: string | null
  notes: string | null
  status: "draft" | "signed" | "void"
}

export type CycleProcedure = "tsi" | "iui" | "icsi" | "frzn_et"
export type CycleAddon = "bc" | "aha" | "imsi" | "e_glue"
export type SpermRetrieval = "tesa" | "tese" | "m_tese"

export interface FertilityCycle extends Versioned {
  id: string
  patient_id: string
  fertility_case_id: string
  doctor_id: string | null
  visit_id: string | null
  cycle_number: number
  status: "active" | "completed" | "cancelled"
  form_code: string
  form_version: number
  wife_name: string | null
  wife_age: number | null
  husband_name: string | null
  husband_age: number | null
  lmp: string | null
  protocol: string | null
  procedure: CycleProcedure | null
  addons: CycleAddon[]
  sperm_retrieval: SpermRetrieval | null
  inf_duration: string | null
  infertility_type: "primary" | "secondary" | null
  primary_note: string | null
  secondary_note: string | null
  address: string | null
  female_factor: string | null
  male_factor: string | null
  unexplained: string | null
  extra_note: string | null
  comments: string | null
  started_at: string
  completed_at: string | null
}

export interface CycleDay extends Versioned {
  id: string
  cycle_id: string
  day_number: number
  cycle_date: string | null
  is_override: boolean
}

export interface CycleMedication extends Versioned {
  id: string
  cycle_id: string
  medication_code: string
  day_number: number
  value: string | null
}

export interface CycleHormone extends Versioned {
  id: string
  cycle_id: string
  hormone_code: string
  value: string | null
  source_result_id: string | null
  source_date: string | null
  source_value: string | null
}

export interface CycleFollicle extends Versioned {
  id: string
  cycle_id: string
  day_number: number
  side: "R" | "L"
  row_index: number
  size: string | null
}

export interface CycleEndometrium extends Versioned {
  id: string
  cycle_id: string
  day_number: number
  value: string | null
}

export interface AuditLog {
  id: number
  occurred_at: string
  actor_id: string | null
  actor_role: string | null
  action: "insert" | "update" | "delete"
  entity_type: string
  entity_id: string | null
  patient_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  changed_fields: string[] | null
  reason: string | null
}

export interface TimelineEvent {
  patient_id: string
  event_type:
    | "patient_created"
    | "appointment"
    | "checked_in"
    | "visit"
    | "fertility_case"
    | "pregnancy_case"
    | "oi_cycle_started"
    | "oi_cycle_completed"
    | "document"
    | "drawing"
    | "prescription"
    | "medical_report"
    | "invoice"
    | "payment"
    | "generated_document"
    | "clinic_visit"
    | "checked_out"
  occurred_at: string
  entity_type: string
  entity_id: string
  subtype: string | null
  status: string | null
  actor_id: string | null
  number: number | null
}

// ---------------------------------------------------------------------
// Pricing & accounting
// ---------------------------------------------------------------------
export type ServiceCategory =
  | "registration"
  | "consultation"
  | "followup"
  | "ultrasound"
  | "investigation"
  | "report"
  | "certificate"
  | "procedure"
  | "treatment"
  | "package"
  | "other"

export interface Service extends Versioned {
  id: string
  code: string | null
  category: ServiceCategory
  name_en: string
  name_ar: string
  price_cash: number
  price_insurance: number | null
  billable: boolean
  insurance_eligible: boolean
  default_duration_minutes: number | null
  appointment_type: string | null
  auto_trigger: "registration" | "ultrasound" | "medical_report" | "medical_certificate" | null
  requires_doctor: boolean
  requires_visit: boolean
  notes: string | null
  active: boolean
  sort_order: number
}

export type InvoiceStatus = "open" | "partially_paid" | "paid" | "no_charge" | "refunded" | "void"
export type PaymentType = "cash" | "insurance" | "mixed"

export interface Invoice extends Versioned {
  id: string
  invoice_number: string
  patient_id: string
  appointment_id: string | null
  visit_id: string | null
  encounter_id: string | null
  doctor_id: string | null
  status: InvoiceStatus
  payment_type: PaymentType
  insurance_company_id: string | null
  insurance_claim_ref: string | null
  currency: string
  subtotal: number
  discount_type: "percent" | "fixed" | null
  discount_value: number
  discount_amount: number
  discount_reason: string | null
  discount_by: string | null
  discount_at: string | null
  total: number
  insurance_amount: number
  patient_amount: number
  paid_patient: number
  paid_insurance: number
  balance_patient: number
  balance_insurance: number
  refunded_total: number
  notes: string | null
  issued_at: string
  void_reason: string | null
  voided_at: string | null
}

export interface InvoiceLine extends Versioned {
  id: string
  invoice_id: string
  service_id: string | null
  description_en: string
  description_ar: string
  quantity: number
  unit_price: number
  line_total: number
  package_line_id: string | null
  source: string
  sort_order: number
}

export type PayMethod = "cash" | "card" | "transfer" | "insurance" | "other"

export interface Payment {
  id: string
  receipt_number: string
  invoice_id: string
  patient_id: string
  kind: "payment" | "refund"
  payer: "patient" | "insurance"
  method: PayMethod
  amount: number
  reference: string | null
  reason: string | null
  refund_of_id: string | null
  register_date: string
  received_at: string
  received_by: string | null
}

export interface CashRegister extends Versioned {
  id: string
  register_date: string
  opening_balance: number
  status: "open" | "closed"
  cash_received: number | null
  cash_refunds: number | null
  cash_expenses: number | null
  expected_cash: number | null
  actual_cash: number | null
  difference: number | null
  notes: string | null
  closed_by: string | null
  closed_at: string | null
}

// ---------------------------------------------------------------------
// Drawings, prescriptions, reports
// ---------------------------------------------------------------------
// Point-based shapes keep transforms baked into their points; boxes and text
// rotate around their top-left corner (degrees, clockwise).
export type DrawingShape =
  | { id: string; type: "pen" | "marker" | "highlight"; points: number[]; color: string; size: number }
  | { id: string; type: "line" | "arrow"; points: [number, number, number, number]; color: string; size: number }
  | { id: string; type: "circle" | "rect"; x: number; y: number; w: number; h: number; color: string; size: number; rotation?: number }
  | { id: string; type: "text"; x: number; y: number; text: string; color: string; size: number; rotation?: number }

export type ClinicalContext = "gynecology" | "fertility" | "pregnancy" | "other"

export interface MedicalImage extends Versioned {
  id: string
  patient_id: string
  visit_id: string
  context: ClinicalContext
  storage_path: string
  mime_type: string
  size_bytes: number
  width: number
  height: number
  title: string | null
  original_filename?: string | null
  status: "active" | "archived"
}

export interface MedicalDrawing extends Versioned {
  id: string
  patient_id: string
  visit_id: string
  image_id: string | null
  template_key: string | null
  context: ClinicalContext
  title: string | null
  notes: string | null
  shapes: DrawingShape[]
  canvas_width: number
  canvas_height: number
  preview_path: string | null
  saved_versions: number
  status: "active" | "archived"
  archived_at?: string | null
  archived_by?: string | null
  archive_reason?: string | null
}

// ---------------------------------------------------------------------
// Clinic visits (encounters): the patient's real presence in the clinic
// ---------------------------------------------------------------------
export type EncounterStatus = "waiting_payment" | "waiting_doctor" | "called" | "with_doctor" | "awaiting_checkout" | "checked_out" | "cancelled"

export interface Encounter extends Versioned {
  id: string
  patient_id: string
  doctor_id: string | null
  appointment_id: string | null
  service_id: string | null
  reason: string | null
  source: "walk_in" | "appointment" | "doctor"
  status: EncounterStatus
  prepay: boolean
  queue_date: string
  arrived_at: string
  sent_to_doctor_at: string | null
  with_doctor_at: string | null
  finished_at: string | null
  checked_out_at: string | null
  cancelled_at: string | null
  status_reason: string | null
  called_at?: string | null
  called_by?: string | null
  patient_sent_at?: string | null
  patient_sent_by?: string | null
}

export interface Medication extends Versioned {
  id: string
  name_en: string
  name_ar: string | null
  generic_name: string | null
  brand_name: string | null
  strength: string | null
  form: string | null
  route: string | null
  default_dose: string | null
  default_frequency: string | null
  default_duration: string | null
  default_instructions: string | null
  active: boolean
  use_count: number
}

export interface Prescription extends Versioned {
  id: string
  prescription_number: string
  patient_id: string
  visit_id: string | null
  doctor_id: string | null
  status: "draft" | "issued" | "cancelled"
  notes: string | null
  issued_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
}

export interface PrescriptionItem extends Versioned {
  id: string
  prescription_id: string
  medication_id: string | null
  medication_name: string
  generic_name: string | null
  strength: string | null
  form: string | null
  dose: string | null
  route: string | null
  frequency: string | null
  duration: string | null
  quantity: string | null
  instructions: string | null
  notes: string | null
  sort_order: number
}

export type ReportLanguage = "ar" | "en" | "bilingual"

export interface ReportTemplate extends Versioned {
  id: string
  code: string | null
  report_type: string
  name_en: string
  name_ar: string
  title_en: string | null
  title_ar: string | null
  recipient_en: string | null
  recipient_ar: string | null
  body_en: string
  body_ar: string
  active: boolean
  is_system: boolean
  sort_order: number
}

export interface MedicalReport extends Versioned {
  id: string
  report_number: string
  patient_id: string | null
  visit_id: string | null
  template_id: string | null
  report_type: string
  language: ReportLanguage
  report_date: string
  title: string | null
  recipient: string | null
  subject_name: string
  subject_dob: string | null
  subject_age: number | null
  subject_country: string | null
  subject_reference: string | null
  subject_patient_code: string | null
  doctor_id: string | null
  body_en: string
  body_ar: string
  status: "draft" | "final" | "void"
  finalized_at: string | null
  void_reason: string | null
}
