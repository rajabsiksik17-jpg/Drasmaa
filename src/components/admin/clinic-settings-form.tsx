"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Building2, CalendarCog, FileText, Hash, Loader2, Phone, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/common/native-select"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { saveClinicSettings } from "@/lib/actions/admin"
import { useRefs } from "@/components/app-context"
import type { ClinicSettings } from "@/types/db"

export function ClinicSettingsForm({ settings }: { settings: ClinicSettings }) {
  const t = useTranslations("admin")
  const router = useRouter()
  const { showError } = useActionError()
  const refs = useRefs()
  const [pending, start] = useTransition()
  const [version, setVersion] = useState(settings.version)
  const [v, setV] = useState({
    clinic_name_en: settings.clinic_name_en,
    clinic_name_ar: settings.clinic_name_ar,
    phone: settings.phone ?? "",
    email: settings.email ?? "",
    address_en: settings.address_en ?? "",
    address_ar: settings.address_ar ?? "",
    default_language: settings.default_language,
    appointment_slot_minutes: settings.appointment_slot_minutes,
    working_hours_start: settings.working_hours_start.slice(0, 5),
    working_hours_end: settings.working_hours_end.slice(0, 5),
    doctor_access_scope: settings.doctor_access_scope,
    receptionist_history_days: settings.receptionist_history_days,
    max_upload_mb: settings.max_upload_mb,
    mobile: settings.mobile ?? "",
    whatsapp: settings.whatsapp ?? "",
    city_en: settings.city_en ?? "",
    city_ar: settings.city_ar ?? "",
    country_en: settings.country_en ?? "",
    country_ar: settings.country_ar ?? "",
    location_text: settings.location_text ?? "",
    license_text: settings.license_text ?? "",
    header_text_en: settings.header_text_en ?? "",
    header_text_ar: settings.header_text_ar ?? "",
    footer_text_en: settings.footer_text_en ?? "",
    footer_text_ar: settings.footer_text_ar ?? "",
    report_footer_en: settings.report_footer_en ?? "",
    report_footer_ar: settings.report_footer_ar ?? "",
    prescription_footer_en: settings.prescription_footer_en ?? "",
    prescription_footer_ar: settings.prescription_footer_ar ?? "",
    invoice_footer_en: settings.invoice_footer_en ?? "",
    invoice_footer_ar: settings.invoice_footer_ar ?? "",
    receipt_footer_en: settings.receipt_footer_en ?? "",
    receipt_footer_ar: settings.receipt_footer_ar ?? "",
    website: settings.website ?? "",
    maps_url: settings.maps_url ?? "",
    main_doctor_id: settings.main_doctor_id ?? "",
    currency: settings.currency ?? "JOD",
    invoice_prefix: settings.invoice_prefix ?? "INV",
    receipt_prefix: settings.receipt_prefix ?? "RCT",
    report_prefix: settings.report_prefix ?? "MED",
    prescription_prefix: settings.prescription_prefix ?? "RX",
  })
  const field = (key: keyof typeof v, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`cs-${key}`}>{label}</Label>
      <Input
        id={`cs-${key}`}
        value={v[key] as string | number}
        onChange={(e) => setV({ ...v, [key]: props.type === "number" ? Number(e.target.value) : e.target.value })}
        {...props}
      />
    </div>
  )
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await saveClinicSettings({ ...v, phone: v.phone || null, address_en: v.address_en || null, address_ar: v.address_ar || null }, version)
          if (!res.ok) {
            showError(res.error)
            if (res.error.code === "conflict") router.refresh()
            return
          }
          setVersion(res.data.version)
          toast.success(t("settingsSaved"))
          router.refresh()
        })
      }}
    >
      <SectionCard title={t("clinicIdentity")} icon={Building2}>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("clinic_name_en", t("nameEn"), { dir: "ltr" })}
          {field("clinic_name_ar", t("nameAr"), { dir: "rtl" })}
          {field("phone", t("phone"), { dir: "ltr" })}
          {field("email", t("email"), { dir: "ltr", type: "email" })}
          {field("address_en", t("addressEn"), { dir: "ltr" })}
          {field("address_ar", t("addressAr"), { dir: "rtl" })}
          <div className="grid gap-1.5">
            <Label htmlFor="cs-lang">{t("defaultLanguage")}</Label>
            <NativeSelect id="cs-lang" value={v.default_language} onChange={(e) => setV({ ...v, default_language: e.target.value as "en" | "ar" })}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("timezone")}</Label>
            <Input value="Asia/Amman" disabled dir="ltr" />
          </div>
        </div>
      </SectionCard>
      <SectionCard title={t("center.contact")} icon={Phone}>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("mobile", t("center.mobile"), { dir: "ltr" })}
          {field("whatsapp", t("center.whatsapp"), { dir: "ltr" })}
          {field("website", t("center.website"), { dir: "ltr", placeholder: "https://" })}
          {field("maps_url", t("center.maps"), { dir: "ltr", placeholder: "https://maps.google.com/..." })}
          {field("city_en", t("center.cityEn"), { dir: "ltr" })}
          {field("city_ar", t("center.cityAr"), { dir: "rtl" })}
          {field("country_en", t("center.countryEn"), { dir: "ltr" })}
          {field("country_ar", t("center.countryAr"), { dir: "rtl" })}
          {field("location_text", t("center.location"), { dir: "auto" })}
          {field("license_text", t("center.license"), { dir: "auto" })}
          <div className="grid gap-1.5">
            <Label htmlFor="cs-main-doctor">{t("center.mainDoctor")}</Label>
            <NativeSelect id="cs-main-doctor" value={v.main_doctor_id} onChange={(e) => setV({ ...v, main_doctor_id: e.target.value })}>
              <option value="">—</option>
              {refs.activeDoctors(v.main_doctor_id || null).map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </SectionCard>
      <SectionCard title={t("center.documents")} icon={FileText}>
        <p className="mb-3 text-xs text-muted-foreground">{t("center.documentsHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("header_text_en", t("center.headerEn"), { dir: "ltr" })}
          {field("header_text_ar", t("center.headerAr"), { dir: "rtl" })}
          {field("footer_text_en", t("center.footerEn"), { dir: "ltr" })}
          {field("footer_text_ar", t("center.footerAr"), { dir: "rtl" })}
          {field("report_footer_en", t("center.reportFooterEn"), { dir: "ltr" })}
          {field("report_footer_ar", t("center.reportFooterAr"), { dir: "rtl" })}
          {field("prescription_footer_en", t("center.rxFooterEn"), { dir: "ltr" })}
          {field("prescription_footer_ar", t("center.rxFooterAr"), { dir: "rtl" })}
          {field("invoice_footer_en", t("center.invoiceFooterEn"), { dir: "ltr" })}
          {field("invoice_footer_ar", t("center.invoiceFooterAr"), { dir: "rtl" })}
          {field("receipt_footer_en", t("center.receiptFooterEn"), { dir: "ltr" })}
          {field("receipt_footer_ar", t("center.receiptFooterAr"), { dir: "rtl" })}
        </div>
      </SectionCard>
      <SectionCard title={t("center.numbering")} icon={Hash}>
        <div className="grid gap-4 sm:grid-cols-5">
          {field("currency", t("center.currency"), { dir: "ltr", maxLength: 3 })}
          {field("invoice_prefix", t("center.invoicePrefix"), { dir: "ltr", maxLength: 6 })}
          {field("receipt_prefix", t("center.receiptPrefix"), { dir: "ltr", maxLength: 6 })}
          {field("report_prefix", t("center.reportPrefix"), { dir: "ltr", maxLength: 6 })}
          {field("prescription_prefix", t("center.rxPrefix"), { dir: "ltr", maxLength: 6 })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("center.numberingHint")}</p>
      </SectionCard>
      <SectionCard title={t("appointmentConfig")} icon={CalendarCog}>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("appointment_slot_minutes", t("slotMinutes"), { type: "number", min: 5, max: 240 })}
          {field("working_hours_start", t("hoursStart"), { type: "time" })}
          {field("working_hours_end", t("hoursEnd"), { type: "time" })}
        </div>
      </SectionCard>
      <SectionCard title={t("accessConfig")} icon={ShieldCheck}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cs-scope">{t("doctorScope")}</Label>
            <NativeSelect id="cs-scope" value={v.doctor_access_scope} onChange={(e) => setV({ ...v, doctor_access_scope: e.target.value as ClinicSettings["doctor_access_scope"] })}>
              <option value="all">{t("scope.all")}</option>
              <option value="department">{t("scope.department")}</option>
              <option value="assigned">{t("scope.assigned")}</option>
            </NativeSelect>
          </div>
          {field("receptionist_history_days", t("historyDays"), { type: "number", min: 1, max: 3650 })}
          {field("max_upload_mb", t("maxUpload"), { type: "number", min: 1, max: 50 })}
        </div>
      </SectionCard>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {t("saveSettings")}
        </Button>
      </div>
    </form>
  )
}
