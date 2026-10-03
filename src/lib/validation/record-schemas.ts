import { z } from "zod"
import { P, type PermissionCode } from "@/lib/permissions"

// Field-level schemas for every table that can be edited inline / autosaved.
// Only fields listed here can ever be written through saveRecord().

const text = (max = 4000) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v))
    .nullable()
const shortText = text(300)
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .or(z.literal("").transform(() => null))
const yesNo = z.boolean().nullable()
const int = (min: number, max: number) => z.number().int().min(min).max(max).nullable()
const num = (min: number, max: number) => z.number().min(min).max(max).nullable()
const uuid = z.uuid().nullable()
const oneOf = <T extends [string, ...string[]]>(...values: T) => z.enum(values).nullable()
const count = int(0, 30)

export interface RecordConfig {
  key: "id" | "patient_id" | "visit_id"
  permission: PermissionCode
  fields: z.ZodRawShape
  /** Column pointing at a visit whose status moves draft -> in_progress. */
  visitColumn?: "visit_id" | "id"
}

export const RECORDS = {
  patients: {
    key: "id",
    permission: P.patientsEdit,
    fields: {
      full_name: z.string().trim().min(2).max(200),
      dob: isoDate,
      occupation: shortText,
      phone: shortText,
      address: text(500),
      marriage_date: isoDate,
      blood_group: oneOf("A", "B", "AB", "O"),
      rh: oneOf("+", "-"),
      payment_method: z.enum(["cash", "insurance"]),
      insurance_company_id: uuid,
      assigned_doctor_id: uuid,
      email: z
        .string()
        .trim()
        .max(320)
        .refine((v) => v === "" || /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(v))
        .transform((v) => (v === "" ? null : v.toLowerCase()))
        .nullable(),
      whatsapp_phone: shortText,
      preferred_language: z.enum(["ar", "en"]),
    },
  },
  patient_husbands: {
    key: "patient_id",
    permission: P.patientsEdit,
    fields: {
      full_name: shortText,
      dob: isoDate,
      occupation: shortText,
      phone: shortText,
      blood_group: oneOf("A", "B", "AB", "O"),
      rh: oneOf("+", "-"),
    },
  },
  patient_medical_history: {
    key: "patient_id",
    permission: P.medicalEdit,
    fields: { ht: yesNo, dm: yesNo, hypothyroidism: yesNo, notes: text() },
  },
  patient_surgical_history: { key: "patient_id", permission: P.medicalEdit, fields: { notes: text() } },
  patient_medications: { key: "patient_id", permission: P.medicalEdit, fields: { notes: text() } },
  patient_social_history: { key: "patient_id", permission: P.medicalEdit, fields: { notes: text() } },
  patient_allergies: { key: "patient_id", permission: P.medicalEdit, fields: { allergy: text(1000) } },
  patient_family_history: {
    key: "patient_id",
    permission: P.medicalEdit,
    fields: { dm: yesNo, ht: yesNo, thrombosis: yesNo, cancer: yesNo, notes: text() },
  },
  patient_menstrual_history: {
    key: "patient_id",
    permission: P.medicalEdit,
    fields: {
      menarche_age: int(6, 25),
      regular_cycle: yesNo,
      period_duration: int(1, 20),
      cycle_frequency: int(10, 120),
      amount: shortText,
      dysmenorrhea: shortText,
      pms: shortText,
      lmp: isoDate,
      notes: text(),
    },
  },
  patient_obstetric_history: {
    key: "patient_id",
    permission: P.medicalEdit,
    fields: {
      gravida: count,
      para: count,
      full_term: count,
      premature: count,
      abortions: count,
      living_male: count,
      living_female: count,
      normal_deliveries: count,
      c_sections: count,
      miscarriages: count,
      miscarriages_first_trimester: count,
      miscarriages_second_trimester: count,
      last_delivery_date: isoDate,
      last_delivery_type: shortText,
      dns: yesNo,
      anc: yesNo,
      anc_dm: yesNo,
      anc_ht: yesNo,
      anc_pph: yesNo,
      anc_abh: yesNo,
      anc_notes: text(),
      ppc: shortText,
      notes: text(),
    },
  },
  appointments: {
    key: "id",
    permission: P.appointmentsEdit,
    fields: {
      notes: text(1000),
      visit_type: z.string().min(1).max(60),
      department_id: z.uuid(),
      payment_method: oneOf("cash", "insurance"),
      insurance_company_id: uuid,
    },
  },
  visit_clinical: {
    key: "visit_id",
    permission: P.visitsEdit,
    visitColumn: "visit_id",
    fields: {
      chief_complaint: text(),
      present_history: text(),
      examination: text(),
      lmp: isoDate,
      edd: isoDate,
      gravida: count,
      para: count,
    },
  },
  gynecology_visits: {
    key: "visit_id",
    permission: P.gynecologyEdit,
    visitColumn: "visit_id",
    fields: {
      complaint: text(),
      irregular_cycle: yesNo,
      lap: yesNo,
      vaginitis: yesNo,
      symptom_notes: text(),
      ultrasound_notes: text(),
      plan: text(),
    },
  },
  fertility_visits: {
    key: "visit_id",
    permission: P.fertilityEdit,
    visitColumn: "visit_id",
    fields: {
      causes_of_infertility: text(),
      notes: text(),
      plan_primary: oneOf("oi", "iui", "ivf"),
      plan_secondary: oneOf("oi", "iui", "ivf"),
      plan_notes: text(),
      ivf_consent_notes: text(),
    },
  },
  fertility_husband_data: {
    key: "visit_id",
    permission: P.fertilityEdit,
    visitColumn: "visit_id",
    fields: {
      count: shortText,
      motility: shortText,
      morphology: shortText,
      viscosity: shortText,
      wbc: shortText,
      notes: text(),
    },
  },
  fertility_wife_data: {
    key: "visit_id",
    permission: P.fertilityEdit,
    visitColumn: "visit_id",
    fields: {
      hormonal_profile: text(),
      hsg_result: oneOf("normal", "abnormal"),
      hsg_notes: text(),
      us: text(),
      us_notes: text(),
      afc: int(0, 200),
      uterus: shortText,
      et: shortText,
      notes: text(),
    },
  },
  fertility_cases: {
    key: "id",
    permission: P.fertilityEdit,
    fields: {
      infertility_type: oneOf("primary", "secondary"),
      duration_years: num(0, 60),
      notes: text(),
      status: z.enum(["active", "closed"]),
    },
  },
  pregnancy_cases: {
    key: "id",
    permission: P.pregnancyEdit,
    fields: {
      lmp: isoDate,
      edd: isoDate,
      gravida: count,
      para: count,
      history: text(),
      outcome: text(1000),
      status: z.enum(["active", "closed"]),
    },
  },
  pregnancy_followups: {
    key: "id",
    permission: P.pregnancyEdit,
    fields: {
      followup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      weight_kg: num(20, 300),
      bp_systolic: int(40, 300),
      bp_diastolic: int(20, 200),
      complaint: text(),
      ultrasound: text(),
      lab: text(),
      plan: text(),
    },
  },
  fertility_cycles: {
    key: "id",
    permission: P.oiEdit,
    fields: {
      wife_name: shortText,
      wife_age: int(10, 80),
      husband_name: shortText,
      husband_age: int(10, 100),
      lmp: isoDate,
      protocol: shortText,
      procedure: oneOf("tsi", "iui", "icsi", "frzn_et"),
      addons: z.array(z.enum(["bc", "aha", "imsi", "e_glue"])).max(4),
      sperm_retrieval: oneOf("tesa", "tese", "m_tese"),
      inf_duration: shortText,
      infertility_type: oneOf("primary", "secondary"),
      primary_note: shortText,
      secondary_note: shortText,
      address: text(500),
      female_factor: shortText,
      male_factor: shortText,
      unexplained: shortText,
      extra_note: shortText,
      comments: text(8000),
      status: z.enum(["active", "completed", "cancelled"]),
    },
  },
  fertility_cycle_days: {
    key: "id",
    permission: P.oiEdit,
    fields: { cycle_date: isoDate, is_override: z.boolean() },
  },
  fertility_cycle_hormones: {
    key: "id",
    permission: P.oiEdit,
    fields: { value: text(40) },
  },
  investigation_results: {
    key: "id",
    permission: P.investigationsEdit,
    fields: {
      value_numeric: z.number().nullable(),
      value_text: text(200),
      result_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: text(1000),
    },
  },
  investigations: {
    key: "id",
    permission: P.investigationsEdit,
    fields: {
      status: z.enum(["requested", "performed", "cancelled"]),
      performed_on: isoDate,
      notes: text(1000),
    },
  },
  documents: {
    key: "id",
    permission: P.documentsUpload,
    fields: {
      title: shortText,
      notes: text(1000),
      category: z.enum(["sfa", "ivf_consent", "investigation", "ultrasound", "medical", "other"]),
    },
  },
  ivf_consents: {
    key: "id",
    permission: P.fertilityEdit,
    fields: {
      technique: oneOf("classic", "icsi"),
      surplus_embryos: oneOf("freeze", "discard"),
      genetic_testing: z.boolean(),
      consent_date: isoDate,
      notes: text(),
      status: z.enum(["draft", "signed", "void"]),
    },
  },
} satisfies Record<string, RecordConfig>

export type RecordTable = keyof typeof RECORDS

export function isRecordTable(value: string): value is RecordTable {
  return Object.prototype.hasOwnProperty.call(RECORDS, value)
}

/** Validate a partial patch against the table's whitelist (unknown keys rejected). */
export function parsePatch(table: RecordTable, patch: Record<string, unknown>) {
  const shape = RECORDS[table].fields as z.ZodRawShape
  return z.strictObject(shape).partial().safeParse(patch)
}
