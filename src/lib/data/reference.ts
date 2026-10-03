import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import type { ReferenceData } from "@/components/app-context"
import type { ClinicSettings, Department, Doctor, DropdownOption, InsuranceCompany, InvestigationType } from "@/types/db"

/** Configurable reference data (small tables), loaded once per request. */
export const getReferenceData = cache(async (): Promise<ReferenceData> => {
  const supabase = await createClient()
  const [doctors, departments, insurance, options, investigationTypes, settings, services] = await Promise.all([
    supabase.from("doctors").select("*").order("sort_order").order("display_name_en"),
    supabase.from("departments").select("*").order("sort_order"),
    supabase.from("insurance_companies").select("*").order("sort_order").order("name_en"),
    supabase.from("dropdown_options").select("*").order("category").order("sort_order"),
    supabase.from("investigation_types").select("*").order("sort_order"),
    supabase.from("clinic_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("services").select("id, code, category, name_en, name_ar, price_cash, price_insurance, billable, insurance_eligible, appointment_type, default_duration_minutes, active, sort_order").order("sort_order"),
  ])
  const s = (settings.data ?? {}) as Partial<ClinicSettings>
  return {
    doctors: (doctors.data ?? []) as Doctor[],
    departments: (departments.data ?? []) as Department[],
    insurance: (insurance.data ?? []) as InsuranceCompany[],
    options: (options.data ?? []) as DropdownOption[],
    investigationTypes: (investigationTypes.data ?? []) as InvestigationType[],
    services: (services.data ?? []) as ReferenceData["services"],
    settings: {
      clinic_name_en: s.clinic_name_en ?? "Clinic",
      clinic_name_ar: s.clinic_name_ar ?? "العيادة",
      phone: s.phone ?? null,
      address_en: s.address_en ?? null,
      address_ar: s.address_ar ?? null,
      appointment_slot_minutes: s.appointment_slot_minutes ?? 15,
      working_hours_start: s.working_hours_start ?? "09:00",
      working_hours_end: s.working_hours_end ?? "18:00",
      max_upload_mb: s.max_upload_mb ?? 20,
      logo_path: s.logo_path ?? null,
      currency: s.currency ?? "JOD",
    },
  }
})
