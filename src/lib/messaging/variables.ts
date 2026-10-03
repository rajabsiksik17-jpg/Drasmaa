import { TZDate } from "@date-fns/tz"
import { format } from "date-fns"
import { arSA, enGB } from "date-fns/locale"
import { CLINIC_TZ, formatDate } from "@/lib/dates"
import { firstName, type TemplateVars } from "./templates"

/** Clinic-local "dd/MM/yyyy" for a timestamp. */
export function messageDate(iso: string): string {
  return format(new TZDate(iso, CLINIC_TZ), "dd/MM/yyyy")
}

/** Clinic-local time with an Arabic/English AM-PM marker. */
export function messageTime(iso: string, language: "ar" | "en"): string {
  return format(new TZDate(iso, CLINIC_TZ), "hh:mm a", { locale: language === "ar" ? arSA : enGB })
}

export interface AppointmentPayload {
  patient_name?: string
  patient_code?: string
  scheduled_at?: string
  doctor_name_en?: string
  doctor_name_ar?: string
  visit_type_en?: string
  visit_type_ar?: string
}

export function appointmentVariables(p: AppointmentPayload, language: "ar" | "en"): TemplateVars {
  const ar = language === "ar"
  const visit = (ar ? p.visit_type_ar : p.visit_type_en) ?? ""
  return {
    patient_name: p.patient_name ?? "",
    patient_first_name: firstName(p.patient_name),
    patient_id: p.patient_code ?? "",
    doctor_name: (ar ? p.doctor_name_ar : p.doctor_name_en) ?? "",
    appointment_date: p.scheduled_at ? messageDate(p.scheduled_at) : "",
    appointment_time: p.scheduled_at ? messageTime(p.scheduled_at, language) : "",
    appointment_type: visit,
    visit_type: visit,
  }
}

export function documentVariables(documentType: string, generatedAt: string): TemplateVars {
  return { document_type: documentType, document_date: messageDate(generatedAt) }
}

export { formatDate }
