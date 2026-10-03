import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { FilePlus2, FileSignature, PenTool } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getSession, hasPermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { formatDate, formatDateTime } from "@/lib/dates"
import { loadDrawings } from "@/lib/data/drawings"
import { EmptyState, SectionCard } from "@/components/common/page"
import { Button } from "@/components/ui/button"
import { DrawingSvg } from "@/components/drawings/drawing-svg"
import { PatientPrescriptions } from "@/components/prescriptions/patient-prescriptions"
import { PatientBilling, type PatientInvoiceRow } from "@/components/accounting/patient-billing"
import { ReportStatusBadgeServer } from "@/components/reports/report-status"
import type { PrescriptionWithItems } from "@/components/prescriptions/prescription-editor"

/** Patient → Prescriptions (all visits + standalone). */
export async function PrescriptionsTab({ patientId }: { patientId: string }) {
  const supabase = await createClient()
  const { data } = await supabase.from("prescriptions").select("*, items:prescription_items(*)").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(100)
  return <PatientPrescriptions patientId={patientId} prescriptions={(data ?? []) as PrescriptionWithItems[]} />
}

/** Patient → Images & drawings: every annotated ultrasound, newest first. */
export async function DrawingsTab({ patientId }: { patientId: string }) {
  const [items, t, locale] = await Promise.all([loadDrawings({ patientId }), getTranslations("drawings"), getLocale()])
  if (items.length === 0) return <EmptyState icon={PenTool} title={t("emptyPatient")} description={t("emptyPatientHint")} />
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[...items].reverse().map(({ drawing, background }) => (
        <li key={drawing.id} className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Link href={`/patients/${patientId}/drawings/${drawing.id}`} className="block bg-neutral-900/90">
            <DrawingSvg shapes={drawing.shapes} width={drawing.canvas_width} height={drawing.canvas_height} background={background} title={drawing.title ?? t("title")} />
          </Link>
          <div className="px-3 py-2 text-sm">
            <p className="font-medium">{drawing.title ?? (drawing.image_id ? t("ultrasoundImage") : t("diagram"))}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(drawing.created_at, locale)} · {t(`contexts.${drawing.context}`)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Patient → Reports (medical reports linked to this patient). */
export async function ReportsTab({ patientId }: { patientId: string }) {
  const session = await getSession()
  const supabase = await createClient()
  const [{ data }, t, locale] = await Promise.all([
    supabase.from("medical_reports").select("id, report_number, report_date, report_type, language, status, doctor:doctors(display_name_en, display_name_ar)").eq("patient_id", patientId).order("report_date", { ascending: false }).limit(100),
    getTranslations("medicalReports"),
    getLocale(),
  ])
  const rows = (data ?? []) as unknown as { id: string; report_number: string; report_date: string; report_type: string; language: string; status: "draft" | "final" | "void"; doctor: { display_name_en: string; display_name_ar: string | null } | null }[]
  return (
    <SectionCard
      title={t("title")}
      icon={FileSignature}
      bodyClassName="p-0"
      actions={
        session && hasPermission(session, P.reportsCreate) ? (
          <Button size="xs" asChild>
            <Link href={`/reports/new?patient=${patientId}`}>
              <FilePlus2 />
              {t("add")}
            </Link>
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("emptyPatient")}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                <FileSignature className="size-4 text-muted-foreground" />
                <span className="font-mono text-xs">{r.report_number}</span>
                <span className="font-medium">{t(`types.${r.report_type}`)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(r.report_date)}
                  {r.doctor && ` · ${locale === "ar" ? r.doctor.display_name_ar || r.doctor.display_name_en : r.doctor.display_name_en}`}
                </span>
                <span className="ms-auto">
                  <ReportStatusBadgeServer status={r.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/** Patient → Billing: invoices, balances, payments. */
export async function BillingTab({ patientId }: { patientId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_number, issued_at, status, total, paid_patient, paid_insurance, balance_patient, balance_insurance, currency, payment_type")
    .eq("patient_id", patientId)
    .order("issued_at", { ascending: false })
    .limit(200)
  return <PatientBilling patientId={patientId} invoices={(data ?? []) as PatientInvoiceRow[]} />
}
