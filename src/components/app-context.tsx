"use client"

import { createContext, useCallback, useContext, useMemo } from "react"
import { useLocale } from "next-intl"
import type { PermissionCode } from "@/lib/permissions"
import type {
  ClinicSettings,
  Department,
  Doctor,
  DropdownOption,
  InsuranceCompany,
  InvestigationType,
  Service,
  UserPreferences,
} from "@/types/db"

export interface ClientSession {
  userId: string
  email: string | null
  fullName: string
  roleCode: string | null
  roleNameEn: string | null
  roleNameAr: string | null
  permissions: string[]
  doctorId: string | null
  preferences: UserPreferences
}

export interface ReferenceData {
  doctors: Doctor[]
  departments: Department[]
  insurance: InsuranceCompany[]
  options: DropdownOption[]
  investigationTypes: InvestigationType[]
  services: Pick<
    Service,
    "id" | "code" | "category" | "name_en" | "name_ar" | "price_cash" | "price_insurance" | "billable" | "insurance_eligible" | "appointment_type" | "default_duration_minutes" | "active" | "sort_order"
  >[]
  settings: Pick<
    ClinicSettings,
    | "clinic_name_en"
    | "clinic_name_ar"
    | "phone"
    | "address_en"
    | "address_ar"
    | "appointment_slot_minutes"
    | "working_hours_start"
    | "working_hours_end"
    | "max_upload_mb"
    | "logo_path"
    | "currency"
  >
}

const AppContext = createContext<{ session: ClientSession; refs: ReferenceData } | null>(null)

export function AppProvider({
  session,
  refs,
  children,
}: {
  session: ClientSession
  refs: ReferenceData
  children: React.ReactNode
}) {
  const value = useMemo(() => ({ session, refs }), [session, refs])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>")
  return ctx
}

export function useSession() {
  return useApp().session
}

export function useCan() {
  const { permissions } = useApp().session
  return useCallback((...codes: PermissionCode[]) => codes.some((c) => permissions.includes(c)), [permissions])
}

/** Localised lookups for configurable reference data. */
export function useRefs() {
  const { refs } = useApp()
  const locale = useLocale()
  const ar = locale === "ar"
  return useMemo(() => {
    const pick = (en: string, arabic: string | null | undefined) => (ar && arabic ? arabic : en)
    return {
      ...refs,
      doctorName: (id: string | null | undefined) => {
        const d = refs.doctors.find((x) => x.id === id)
        return d ? pick(d.display_name_en, d.display_name_ar) : ""
      },
      departmentName: (id: string | null | undefined) => {
        const d = refs.departments.find((x) => x.id === id)
        return d ? pick(d.name_en, d.name_ar) : ""
      },
      insuranceName: (id: string | null | undefined) => {
        const d = refs.insurance.find((x) => x.id === id)
        return d ? pick(d.name_en, d.name_ar) : ""
      },
      optionLabel: (category: string, value: string | null | undefined) => {
        if (!value) return ""
        const o = refs.options.find((x) => x.category === category && x.value === value)
        return o ? pick(o.label_en, o.label_ar) : value
      },
      /** Active options for new selections; `keep` keeps a historical inactive value selectable. */
      activeOptions: (category: string, keep?: string | null) =>
        refs.options
          .filter((o) => o.category === category && (o.active || o.value === keep))
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((o) => ({ value: o.value, label: pick(o.label_en, o.label_ar) })),
      activeDoctors: (keep?: string | null) =>
        refs.doctors
          .filter((d) => d.active || d.id === keep)
          .map((d) => ({ value: d.id, label: pick(d.display_name_en, d.display_name_ar), departmentId: d.department_id })),
      activeDepartments: (keep?: string | null) =>
        refs.departments
          .filter((d) => d.active || d.id === keep)
          .map((d) => ({ value: d.id, label: pick(d.name_en, d.name_ar), code: d.code })),
      activeInsurance: (keep?: string | null) =>
        refs.insurance
          .filter((d) => d.active || d.id === keep)
          .map((d) => ({ value: d.id, label: pick(d.name_en, d.name_ar) })),
      investigationName: (code: string) => {
        const t = refs.investigationTypes.find((x) => x.code === code)
        return t ? pick(t.name_en, t.name_ar) : code
      },
      clinicName: pick(refs.settings.clinic_name_en, refs.settings.clinic_name_ar),
      clinicAddress: pick(refs.settings.address_en ?? "", refs.settings.address_ar),
      pick,
    }
  }, [refs, ar])
}
