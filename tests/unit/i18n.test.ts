import { describe, expect, it } from "vitest"
import en from "../../messages/en.json"
import ar from "../../messages/ar.json"

import { missingKeys } from "../../scripts/i18n-keys.mjs"
import { NOTIFICATION_TYPES } from "@/types/db"
import { DOCUMENT_TYPES, SUMMARY_SECTIONS } from "@/lib/documents/registry"
import { TEMPLATE_VARIABLES } from "@/lib/messaging/templates"
import { ACCOUNTING_REPORTS } from "@/lib/accounting/report-kinds"

type Tree = { [k: string]: string | Tree }

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)))
}

const get = (tree: Tree, key: string) => key.split(".").reduce<unknown>((n, p) => (n as Tree | undefined)?.[p], tree)

describe("translations", () => {
  it("English and Arabic have exactly the same keys", () => {
    const a = flatten(en as Tree).sort()
    const b = flatten(ar as Tree).sort()
    expect(b.filter((k) => !a.includes(k))).toEqual([])
    expect(a.filter((k) => !b.includes(k))).toEqual([])
  })

  it("every key referenced in the source exists", () => {
    expect(missingKeys(en)).toEqual([])
    expect(missingKeys(ar)).toEqual([])
  })

  it("covers keys built from runtime values", () => {
    const dynamic = [
      ...["scheduled", "checked_in", "with_doctor", "completed", "cancelled", "no_show", "rescheduled"].map((s) => `status.${s}`),
      ...["draft", "in_progress", "completed", "cancelled"].map((s) => `visitStatus.${s}`),
      ...["active", "closed", "completed", "cancelled"].map((s) => `caseStatus.${s}`),
      ...["connected", "reconnecting", "offline"].flatMap((s) => [`connection.${s}`, `connection.${s}Hint`]),
      ...[
        "unauthenticated", "forbidden", "notFound", "conflict", "duplicate", "doubleBooking", "invalidTransition",
        "rescheduleRequired", "reasonRequired", "missingFields", "pregnancyCaseRequired", "visitCancelled",
        "invalidValue", "invalidReference", "validation", "uploadFailed", "fileTooLarge", "fileType", "network", "unexpected",
      ].map((c) => `errors.${c}`),
      ...["dashboard", "patients", "appointments", "tomorrow", "notifications", "settings", "users", "roles", "doctors", "departments", "insurance", "options", "clinic", "audit"].map((k) => `nav.${k}`),
      ...["he-patient", "he-present", "he-menstrual", "he-obstetric", "he-medical", "he-family", "he-allergy"].map((k) => `historyExam.sections.${k}`),
      ...["overview", "personal", "medical", "visits", "appointments", "fertility", "pregnancy", "oi", "investigations", "documents", "communications", "timeline", "audit"].map((k) => `patient.tabs.${k}`),
      ...["today", "tomorrow", "upcoming", "previous", "calendar"].map((k) => `appointments.tabs.${k}`),
      ...NOTIFICATION_TYPES.flatMap((k) => [`notifications.types.${k}.title`, `notifications.types.${k}.body`]),
      ...["appointments", "patients", "medical", "system", "security", "admin"].map((k) => `notifications.category.${k}`),
      ...["low", "normal", "high", "critical"].map((k) => `notifications.priority.${k}`),
      ...[
        "rateLimited", "accountLocked", "otpInvalid", "otpExpired", "otpLocked", "otpCooldown", "emailNotConfigured", "emailFailed",
        "encryptionKeyMissing", "serviceKeyMissing", "invalidPhone", "invalidEmail", "pdfFailed",
      "registerClosed",
      ].map((c) => `errors.${c}`),
      ...["reports", "accounting", "pricing", "medications", "reportTemplates"].map((k) => `nav.${k}`),
      ...["prescriptions", "drawings", "reports", "billing"].map((k) => `patient.tabs.${k}`),
      ...["open", "partially_paid", "paid", "no_charge", "void"].map((k) => `accounting.status.${k}`),
      ...["cash", "card", "transfer", "insurance", "other"].map((k) => `accounting.methods.${k}`),
      ...["cash", "insurance", "mixed"].map((k) => `accounting.paymentTypes.${k}`),
      ...["manual", "appointment", "ultrasound", "medical_report", "medical_certificate", "package"].map((k) => `accounting.sources.${k}`),
      ...ACCOUNTING_REPORTS.flatMap((k) => [`accounting.reports.kinds.${k}.title`, `accounting.reports.kinds.${k}.hint`]),
      ...["general", "gynecology", "fertility", "pregnancy", "opinion", "referral", "certificate", "international", "followup", "custom"].map((k) => `medicalReports.types.${k}`),
      ...["ar", "en", "bilingual"].map((k) => `medicalReports.languages.${k}`),
      ...["draft", "final", "void"].map((k) => `medicalReports.status.${k}`),
      ...["draft", "issued", "cancelled"].map((k) => `prescriptions.status.${k}`),
      ...["pen", "marker", "highlight", "line", "arrow", "circle", "rect", "text", "eraser", "pan"].map((k) => `drawings.tools.${k}`),
      ...["gynecology", "fertility", "pregnancy", "other"].map((k) => `drawings.contexts.${k}`),
      ...["drawing", "prescription", "medical_report", "invoice", "payment", "generated_document"].map((k) => `timeline.event.${k}`),
      ...["email", "notificationSettings", "templates", "whatsapp", "documentTemplates", "securityCenter", "authentication", "sessions"].map((k) => `nav.${k}`),
      ...["clinic", "communication", "security"].map((k) => `nav.group.${k}`),
      ...["not_configured", "encryption_key_missing", "connection_failed", "tls_failed", "auth_failed", "recipient_rejected", "send_failed", "timeout"].map((k) => `emailSettings.errorCodes.${k}`),
      ...["unknown", "ok", "failed", "disabled"].map((k) => `emailSettings.status.${k}`),
      ...TEMPLATE_VARIABLES.map((k) => `templates.variables.${k}`),
      ...["appointment", "medical_followup", "pregnancy", "fertility", "ivf", "general", "congratulations", "administrative", "security", "documents", "custom"].map((k) => `templates.category.${k}`),
      ...DOCUMENT_TYPES.map((k) => `documentTypes.${k}`),
      ...SUMMARY_SECTIONS.map((s) => `reports.sections.${s.key}`),
      ...["pending_otp", "active", "revoked", "signed_out"].map((k) => `sessions.status.${k}`),
      ...[
        "login_success", "session_started", "login_failed", "login_locked", "logout", "otp_sent", "otp_verified",
        "otp_failed", "otp_expired", "otp_locked", "session_revoked", "password_changed", "password_reset_requested",
      ].map((k) => `sessions.events.${k}`),
      ...["prepared", "opened", "queued", "sent", "failed", "skipped"].map((k) => `communications.statuses.${k}`),
      ...["whatsapp", "email", "in_app", "system"].map((k) => `communications.channels.${k}`),
      ...["https", "encryption", "serviceKey", "email", "otp", "failedLogins", "criticalEvents", "backups"].map((k) => `securityCenter.check.${k}.title`),
      ...["disabled", "new_device", "every_login"].flatMap((k) => [`authSettings.modes.${k}.title`, `authSettings.modes.${k}.hint`]),
      ...["sfa", "ivf_consent", "investigation", "ultrasound", "medical", "other"].map((k) => `documents.categories.${k}`),
      ...["blood_pressure", "followup_date", "plan_primary", "complaint"].map((k) => `fields.${k}`),
      "oi.primary",
      "oi.secondary",
      "newPatient.cash",
      "newPatient.insurance",
    ]
    for (const tree of [en, ar] as Tree[]) {
      expect(dynamic.filter((k) => typeof get(tree, k) !== "string")).toEqual([])
    }
  })
})
