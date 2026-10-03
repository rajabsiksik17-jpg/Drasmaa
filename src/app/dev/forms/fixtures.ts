// Fictional sample rows for the development-only form preview. Not used in production.
import type { ReferenceData } from "@/components/app-context"
import type { HistoryExamData } from "@/components/medical/history-exam-form"
import type { CycleBundle } from "@/lib/data/cycle"
import type { PregnancyCase, PregnancyFollowup } from "@/types/db"

const meta = { version: 1, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z", created_by: null, updated_by: null }
const pid = "11111111-1111-4111-8111-111111111111"

export const refs: ReferenceData = {
  doctors: [],
  departments: [],
  insurance: [],
  investigationTypes: [],
  services: [],
  options: [
    { ...meta, id: "o1", category: "oi_protocol", value: "antagonist", label_en: "Antagonist", label_ar: "بروتوكول المضاد", active: true, sort_order: 1 },
    { ...meta, id: "o2", category: "delivery_type", value: "nvd", label_en: "Normal (NVD)", label_ar: "ولادة طبيعية", active: true, sort_order: 1 },
  ],
  settings: {
    currency: "JOD",
    clinic_name_en: "Demo Women's Health Clinic",
    clinic_name_ar: "عيادة تجريبية لصحة المرأة",
    phone: "+962 6 000 0000",
    address_en: "Amman, Jordan",
    address_ar: "عمّان، الأردن",
    appointment_slot_minutes: 15,
    working_hours_start: "09:00",
    working_hours_end: "18:00",
    max_upload_mb: 20,
    logo_path: null,
  },
}

export const history: HistoryExamData = {
  patient: {
    ...meta, id: pid, patient_code: "PAT-000123", full_name: "Sample Patient One", dob: "1994-06-14", occupation: "Teacher",
    phone: "0790000001", address: "Amman — Sample St. 1", marriage_date: "2020-05-12", blood_group: "A", rh: "+",
    payment_method: "cash", insurance_company_id: null, assigned_doctor_id: null,
  email: null,
  whatsapp_phone: null,
  preferred_language: "ar", status: "active",
  },
  husband: { ...meta, patient_id: pid, full_name: "Sample Husband One", dob: "1990-03-02", occupation: "Accountant", phone: null, blood_group: "B", rh: "+" },
  menstrual: {
    ...meta, patient_id: pid, menarche_age: 13, regular_cycle: true, period_duration: 5, cycle_frequency: 28,
    amount: "Moderate", dysmenorrhea: "Mild", pms: "No", lmp: "2026-09-20", notes: null,
  },
  obstetric: {
    ...meta, patient_id: pid, gravida: 2, para: 1, full_term: 1, premature: 0, abortions: 1, living_male: 0, living_female: 1,
    normal_deliveries: 1, c_sections: 0, miscarriages: 1, miscarriages_first_trimester: 1, miscarriages_second_trimester: 0,
    last_delivery_date: "2021-08-10", last_delivery_type: "nvd", dns: false, anc: true, anc_dm: false, anc_ht: false,
    anc_pph: false, anc_abh: false, anc_notes: null, ppc: "Uneventful", notes: null,
  },
  medical: { ...meta, patient_id: pid, ht: false, dm: false, hypothyroidism: true, notes: "On thyroxine 50 mcg" },
  surgical: { ...meta, patient_id: pid, notes: "Laparoscopic appendectomy 2015" },
  medications: { ...meta, patient_id: pid, notes: "Thyroxine 50 mcg daily" },
  family: { ...meta, patient_id: pid, dm: true, ht: false, thrombosis: false, cancer: false, notes: "Mother: T2DM" },
  social: { ...meta, patient_id: pid, notes: "Non-smoker" },
  allergy: { ...meta, patient_id: pid, allergy: "Penicillin" },
  visit: {
    ...meta, visit_id: "22222222-2222-4222-8222-222222222222", chief_complaint: "Delayed conception",
    present_history: "Trying to conceive for 2 years. Regular cycles.", examination: null,
    lmp: "2026-09-20", edd: null, gravida: 2, para: 1, imported_at: "2026-10-03T08:00:00Z",
  },
  visitDate: "2026-10-03",
}

const cycleId = "33333333-3333-4333-8333-333333333333"
export const cycle: CycleBundle = {
  cycle: {
    ...meta, id: cycleId, patient_id: pid, fertility_case_id: "c1", doctor_id: null, visit_id: null, cycle_number: 1, status: "active",
    form_code: "oi_chart", form_version: 1, wife_name: "Sample Patient One", wife_age: 32, husband_name: "Sample Husband One",
    husband_age: 36, lmp: "2026-10-01", protocol: "antagonist", procedure: "icsi", addons: ["aha"], sperm_retrieval: null,
    inf_duration: "2 years", infertility_type: "secondary", primary_note: null, secondary_note: "after 1 child", address: "Amman — Sample St. 1",
    female_factor: "Low AMH", male_factor: null, unexplained: null, extra_note: null, comments: "Trigger when 3 follicles ≥ 17 mm.",
    started_at: "2026-10-03T08:00:00Z", completed_at: null,
  },
  fcase: null,
  days: Array.from({ length: 15 }, (_, i) => ({
    ...meta, id: `d${i + 1}`, cycle_id: cycleId, day_number: i + 1,
    cycle_date: new Date(Date.UTC(2026, 9, 3 + i)).toISOString().slice(0, 10), is_override: false,
  })),
  medications: [
    ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({ ...meta, id: `m${d}`, cycle_id: cycleId, medication_code: "rec_fsh", day_number: d, value: "150" })),
    ...[6, 7, 8].map((d) => ({ ...meta, id: `a${d}`, cycle_id: cycleId, medication_code: "gnrh_antag", day_number: d, value: "0.25" })),
  ],
  hormones: [
    { ...meta, id: "h1", cycle_id: cycleId, hormone_code: "amh", value: "1.1", source_result_id: "r1", source_date: "2026-09-03", source_value: "1.1" },
    { ...meta, id: "h2", cycle_id: cycleId, hormone_code: "fsh", value: "7.2", source_result_id: "r2", source_date: "2026-09-03", source_value: "7.2" },
    { ...meta, id: "h3", cycle_id: cycleId, hormone_code: "lh", value: "5.1", source_result_id: "r3", source_date: "2026-09-03", source_value: "5.1" },
    { ...meta, id: "h4", cycle_id: cycleId, hormone_code: "e2", value: "41", source_result_id: "r4", source_date: "2026-09-03", source_value: "41" },
    { ...meta, id: "h5", cycle_id: cycleId, hormone_code: "p4", value: null, source_result_id: null, source_date: null, source_value: null },
    { ...meta, id: "h6", cycle_id: cycleId, hormone_code: "prolactin", value: "14", source_result_id: "r6", source_date: "2026-09-03", source_value: "14" },
    { ...meta, id: "h7", cycle_id: cycleId, hormone_code: "tsh", value: "2.1", source_result_id: "r7", source_date: "2026-09-03", source_value: "2.1" },
  ],
  follicles: [
    ["R", 0, 14], ["L", 0, 11], ["R", 1, 12], ["L", 1, 10], ["R", 2, 10],
  ].flatMap(([side, row, size]) => [
    { ...meta, id: `f6${side}${row}`, cycle_id: cycleId, day_number: 6, side: side as "R" | "L", row_index: row as number, size: String(size) },
    { ...meta, id: `f8${side}${row}`, cycle_id: cycleId, day_number: 8, side: side as "R" | "L", row_index: row as number, size: String((size as number) + 3) },
  ]),
  endometrium: [
    { ...meta, id: "e6", cycle_id: cycleId, day_number: 6, value: "7.5" },
    { ...meta, id: "e8", cycle_id: cycleId, day_number: 8, value: "9" },
  ],
  otherCycles: [],
}

export const pregnancy: { pcase: PregnancyCase; followups: PregnancyFollowup[] } = {
  pcase: {
    ...meta, id: "p1", patient_id: pid, case_number: 1, status: "active", outcome: null, lmp: "2026-07-01", edd: null,
    gravida: 3, para: 1, history: "Previous NVD 2021. Hypothyroid on thyroxine.", opened_at: "2026-08-10T08:00:00Z", closed_at: null,
  },
  followups: [
    {
      ...meta, id: "fu1", pregnancy_case_id: "p1", visit_id: null, visit_no: 1, followup_date: "2026-08-10", weight_kg: 64.5,
      bp_systolic: 110, bp_diastolic: 70, complaint: "Nausea", ultrasound: "Single viable IUP, CRL 1.2 cm", lab: "CBC, TSH", plan: "Folic acid; review 4 weeks",
    },
    {
      ...meta, id: "fu2", pregnancy_case_id: "p1", visit_id: null, visit_no: 2, followup_date: "2026-10-03", weight_kg: 66,
      bp_systolic: 115, bp_diastolic: 75, complaint: "None", ultrasound: "NT normal", lab: "", plan: "Anomaly scan at 20 w",
    },
  ],
}
