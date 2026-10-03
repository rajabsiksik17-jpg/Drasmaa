"use client"

import { useCallback } from "react"
import { useLocale, useTranslations } from "next-intl"
import { formatDateTime, formatTime } from "@/lib/dates"
import { NOTIFICATION_TYPES, type AppNotification } from "@/types/db"

/**
 * Notifications store stable data; each client renders them in its own
 * language. Bodies only contain operational information (names, times,
 * devices) — never clinical details.
 */
export function useNotificationText() {
  const t = useTranslations("notifications")
  const locale = useLocale()
  return useCallback(
    (n: AppNotification) => {
      const d = n.data ?? {}
      const str = (v: unknown) => (typeof v === "string" ? v : "")
      const doctor = str(locale === "ar" ? d.doctor_name_ar : d.doctor_name_en)
      const visit = str(locale === "ar" ? d.visit_type_ar : d.visit_type_en) || str(d.visit_type)
      const offset = typeof d.offset_minutes === "number" ? d.offset_minutes : 0
      const values = {
        patient: str(d.patient_name),
        code: str(d.patient_code),
        time: d.scheduled_at ? formatTime(str(d.scheduled_at), locale) : "",
        when: d.scheduled_at ? formatDateTime(str(d.scheduled_at), locale) : "",
        doctor,
        visit,
        device: [str(d.browser), str(d.os)].filter(Boolean).join(" / ") || (n.message ?? ""),
        hours: Math.floor(offset / 60),
        minutes: offset,
        detail: n.message ?? "",
      }
      if (!(NOTIFICATION_TYPES as readonly string[]).includes(n.type) || n.type === "system") {
        return { title: n.title, body: n.message ?? "" }
      }
      return { title: t(`types.${n.type}.title`, values), body: t(`types.${n.type}.body`, values) }
    },
    [t, locale],
  )
}
