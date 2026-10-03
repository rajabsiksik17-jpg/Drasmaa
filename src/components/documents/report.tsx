import "server-only"
import { getLocale, getTranslations } from "next-intl/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getSession } from "@/lib/auth/session"
import { ageFromDob, formatDate, formatDateTime } from "@/lib/dates"
import { SUPABASE_URL } from "@/lib/supabase/env"
import type { DocumentType } from "@/lib/documents/registry"

/*
 * Building blocks of the report-style documents. Server components: data
 * is read with the viewer's RLS-bound client; the same markup is shown in
 * the in-app preview and printed to PDF by the headless renderer.
 */

export interface ReportPatient {
  id: string
  full_name: string
  patient_code: string
  dob: string | null
  phone: string | null
}

export interface ReportDoctor {
  id: string
  display_name_en: string
  display_name_ar: string | null
  specialty: string | null
  title_en: string | null
  title_ar: string | null
  signature_path: string | null
}

export async function loadTemplate(type: DocumentType) {
  const supabase = await createClient()
  const { data } = await supabase.from("document_templates").select("*").eq("document_type", type).maybeSingle()
  return data as {
    name_en: string
    name_ar: string
    show_logo: boolean
    show_header: boolean
    show_patient_block: boolean
    show_doctor_info: boolean
    show_signature: boolean
    footer_text_en: string | null
    footer_text_ar: string | null
  } | null
}

/**
 * A doctor's signature image is embedded only when the template allows it,
 * the doctor uploaded one, and the person generating the document IS that
 * doctor (never someone else's signature).
 */
async function signatureDataUrl(doctor: ReportDoctor | null, allowed: boolean) {
  if (!allowed || !doctor?.signature_path) return null
  const session = await getSession()
  if (!session || session.doctor?.id !== doctor.id) return null
  try {
    const { data } = await createAdminClient().storage.from("clinic-private").download(doctor.signature_path)
    if (!data) return null
    const type = data.type || "image/png"
    return `data:${type};base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`
  } catch {
    return null
  }
}

export type FooterKind = "report" | "prescription" | "invoice" | "receipt" | null

export interface ReportSubject {
  name: string
  code?: string | null
  dob?: string | null
  age?: number | null
  extra?: [string, string | null][]
}

/**
 * The single document frame used by every generated document: center
 * information (logos, names, contacts, address, license, header / footer
 * texts) always comes from Clinic settings — never hard-coded per template.
 */
export async function ReportDocument({
  type,
  title,
  subtitle,
  patient,
  subject,
  doctor,
  children,
  landscape = false,
  number,
  documentDate,
  footerKind = null,
}: {
  type: DocumentType
  title?: string
  subtitle?: string
  /** Registered patient (identity block). */
  patient?: ReportPatient | null
  /** Or: a person who is not a registered patient (standalone report). */
  subject?: ReportSubject | null
  doctor?: ReportDoctor | null
  children: React.ReactNode
  landscape?: boolean
  /** Document number (report / invoice / receipt / prescription). */
  number?: string | null
  documentDate?: string | null
  footerKind?: FooterKind
}) {
  const t = await getTranslations("reports")
  const locale = await getLocale()
  const ar = locale === "ar"
  const supabase = await createClient()
  const [template, { data: clinic }] = await Promise.all([loadTemplate(type), supabase.from("clinic_settings").select("*").eq("id", 1).single()])
  const signature = await signatureDataUrl(doctor ?? null, template?.show_signature ?? false)
  const docTitle = title ?? (ar ? template?.name_ar : template?.name_en) ?? type
  const asset = (path: string | null | undefined) => (path ? `${SUPABASE_URL}/storage/v1/object/public/clinic-assets/${path}` : null)
  const logo = template?.show_logo !== false ? asset(clinic?.logo_path) : null
  const logo2 = template?.show_logo !== false ? asset(clinic?.secondary_logo_path) : null
  const doctorName = doctor ? (ar ? doctor.display_name_ar || doctor.display_name_en : doctor.display_name_en) : null
  const pick = (en?: string | null, arText?: string | null) => (ar ? arText || en : en || arText) ?? null
  const address = [pick(clinic?.address_en, clinic?.address_ar), pick(clinic?.city_en, clinic?.city_ar), pick(clinic?.country_en, clinic?.country_ar)].filter(Boolean).join(" · ")
  const contacts = [clinic?.phone, clinic?.mobile, clinic?.email, clinic?.website?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ")
  const kindFooter =
    footerKind === "report" ? pick(clinic?.report_footer_en, clinic?.report_footer_ar)
    : footerKind === "prescription" ? pick(clinic?.prescription_footer_en, clinic?.prescription_footer_ar)
    : footerKind === "invoice" ? pick(clinic?.invoice_footer_en, clinic?.invoice_footer_ar)
    : footerKind === "receipt" ? pick(clinic?.receipt_footer_en, clinic?.receipt_footer_ar)
    : null
  const footer = [pick(template?.footer_text_en, template?.footer_text_ar), kindFooter, pick(clinic?.footer_text_en, clinic?.footer_text_ar)].filter(Boolean)
  const headerText = pick(clinic?.header_text_en, clinic?.header_text_ar)
  const person = patient
    ? { name: patient.full_name, code: patient.patient_code, dob: patient.dob, age: ageFromDob(patient.dob), extra: [] as [string, string | null][] }
    : subject
      ? { name: subject.name, code: subject.code ?? null, dob: subject.dob ?? null, age: subject.age ?? ageFromDob(subject.dob ?? null), extra: subject.extra ?? [] }
      : null

  return (
    <article className={landscape ? "report print-landscape mx-auto max-w-[297mm]" : "report mx-auto max-w-[210mm]"} lang={locale} dir={ar ? "rtl" : "ltr"}>
      <div className="paper bg-white px-8 py-7 text-[12.5px] leading-relaxed text-black print:px-0 print:py-0">
        {template?.show_header !== false && (
          <header className="mb-4 border-b-2 border-black/80 pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-16 w-auto object-contain" />
                )}
                <div>
                  <p className="text-[16px] font-bold">{ar ? clinic?.clinic_name_ar : clinic?.clinic_name_en}</p>
                  <p className="text-[11px] text-black/70">{ar ? clinic?.clinic_name_en : clinic?.clinic_name_ar}</p>
                  {template?.show_doctor_info !== false && doctorName && (
                    <p className="text-[11.5px] font-semibold">
                      {doctorName}
                      {doctor?.specialty && <span className="font-normal text-black/70"> — {doctor.specialty}</span>}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3 text-end">
                <div>
                  <h1 className="text-[17px] font-bold">{docTitle}</h1>
                  {number && <p className="font-mono text-[11.5px]">{number}</p>}
                  {subtitle && <p className="text-[11.5px]">{subtitle}</p>}
                  <p className="text-[10.5px] text-black/70">
                    {documentDate ? formatDate(documentDate) : t("generatedOn", { date: formatDateTime(new Date().toISOString(), locale) })}
                  </p>
                </div>
                {logo2 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo2} alt="" className="h-14 w-auto object-contain" />
                )}
              </div>
            </div>
            {(address || contacts) && (
              <p className="mt-2 text-[10.5px] text-black/70">
                {address}
                {address && contacts && " · "}
                <span dir="ltr">{contacts}</span>
              </p>
            )}
            {(clinic?.license_text || headerText) && (
              <p className="text-[10px] text-black/60">{[clinic?.license_text, headerText].filter(Boolean).join(" · ")}</p>
            )}
          </header>
        )}

        {template?.show_patient_block !== false && person && (
          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-black/30 px-3 py-2 text-[12px] sm:grid-cols-4 print:grid-cols-4">
            <div>
              <dt className="text-[10px] text-black/60">{t("patient")}</dt>
              <dd className="font-semibold break-words">{person.name}</dd>
            </div>
            {person.code && (
              <div>
                <dt className="text-[10px] text-black/60">{patient ? t("patientId") : t("reference")}</dt>
                <dd className="font-mono">{person.code}</dd>
              </div>
            )}
            {(person.dob || person.age != null) && (
              <div>
                <dt className="text-[10px] text-black/60">{person.dob ? t("dob") : t("ageLabel")}</dt>
                <dd>
                  {person.dob ? formatDate(person.dob) : ""}
                  {person.age != null && (person.dob ? ` (${t("age", { age: person.age })})` : t("age", { age: person.age }))}
                </dd>
              </div>
            )}
            {person.extra
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] text-black/60">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        )}

        <div className="space-y-4">{children}</div>

        {template?.show_doctor_info !== false && doctor && (
          <div className="print-avoid-break mt-10 flex justify-end">
            <div className="min-w-56 text-center">
              {signature ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signature} alt="" className="mx-auto h-16 w-auto object-contain" />
              ) : (
                <div className="h-16" />
              )}
              <p className="border-t border-black/60 pt-1 font-semibold">{doctorName}</p>
              {(ar ? doctor.title_ar : doctor.title_en) && <p className="text-[11px]">{ar ? doctor.title_ar : doctor.title_en}</p>}
              {doctor.specialty && <p className="text-[11px] text-black/70">{doctor.specialty}</p>}
            </div>
          </div>
        )}
        {footer.length > 0 && (
          <div className="mt-6 space-y-0.5 border-t border-black/20 pt-2 text-center text-[10.5px] text-black/70">
            {footer.map((f, i) => (
              <p key={i}>{f}</p>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

export function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <h2 className="mb-1.5 border-b border-black/40 pb-0.5 text-[13.5px] font-bold" style={{ breakAfter: "avoid" }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Table whose header row repeats on every printed page; rows never split. */
export function ReportTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="text-black/60">{empty ?? "—"}</p>
  return (
    <table className="w-full border-collapse text-[11.5px]">
      <thead style={{ display: "table-header-group" }}>
        <tr>
          {head.map((h, i) => (
            <th key={i} className="border border-black/50 bg-black/[0.06] px-1.5 py-1 text-start font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ breakInside: "avoid" }}>
            {r.map((c, j) => (
              <td key={j} className="border border-black/40 px-1.5 py-1 align-top break-words whitespace-pre-wrap">
                {c ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function KeyValues({ items }: { items: [string, React.ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "")
  if (shown.length === 0) return <p className="text-black/60">—</p>
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
      {shown.map(([k, v]) => (
        <div key={k} className="flex gap-2" style={{ breakInside: "avoid" }}>
          <dt className="shrink-0 text-black/60">{k}:</dt>
          <dd className="min-w-0 break-words whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export const yesNo = (v: boolean | null | undefined, labels: { yes: string; no: string }) => (v == null ? null : v ? labels.yes : labels.no)

export async function loadDoctor(doctorId: string | null | undefined): Promise<ReportDoctor | null> {
  if (!doctorId) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("doctors")
    .select("id, display_name_en, display_name_ar, specialty, title_en, title_ar, signature_path")
    .eq("id", doctorId)
    .maybeSingle()
  return (data as ReportDoctor | null) ?? null
}

export async function loadReportPatient(patientId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("patients")
    .select("id, full_name, patient_code, dob, phone, assigned_doctor_id")
    .eq("id", patientId)
    .maybeSingle()
  return data as (ReportPatient & { assigned_doctor_id: string | null }) | null
}

export { formatDate, formatDateTime }
