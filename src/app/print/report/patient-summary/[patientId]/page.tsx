import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { SUMMARY_SECTIONS } from "@/lib/documents/registry"
import { messageDate } from "@/lib/messaging/variables"
import { KeyValues, ReportDocument, ReportSection, ReportTable, formatDate, formatDateTime, loadDoctor, loadReportPatient, yesNo } from "@/components/documents/report"

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null || v === "" ? null : String(v))

export default async function PatientSummaryReport({ params, searchParams }: PageProps<"/print/report/patient-summary/[patientId]">) {
  const session = await requirePagePermission(P.patientsView)
  const { patientId } = await params
  if (!/^[0-9a-f-]{36}$/.test(patientId)) notFound()
  const sp = await searchParams
  const requested = typeof sp.sections === "string" ? sp.sections.split(",") : SUMMARY_SECTIONS.filter((x) => x.default).map((x) => x.key as string)
  // Server-side: only sections this viewer may see are ever rendered.
  const sections = new Set(SUMMARY_SECTIONS.filter((x) => requested.includes(x.key) && hasPermission(session, x.permission)).map((x) => x.key as string))

  const patient = await loadReportPatient(patientId)
  if (!patient) notFound()
  const t = await getTranslations("reports")
  const tc = await getTranslations("common")
  const tt = await getTranslations("timeline")
  const locale = await getLocale()
  const ar = locale === "ar"
  const supabase = await createClient()
  const one = async (table: string) => ((await supabase.from(table).select("*").eq("patient_id", patientId).maybeSingle()).data ?? {}) as Row
  const has = (k: string) => sections.has(k)

  const [full, husband, med, surg, allergy, family, meds, obst, results, types, appts, visits, pregnancies, fertility, gyn, docs, doctor] = await Promise.all([
    has("patient") ? supabase.from("patients").select("*").eq("id", patientId).single().then((r) => (r.data ?? {}) as Row) : null,
    has("partner") ? one("patient_husbands") : null,
    has("medical_history") ? one("patient_medical_history") : null,
    has("surgical_history") ? one("patient_surgical_history") : null,
    has("allergies") ? one("patient_allergies") : null,
    has("family_history") ? one("patient_family_history") : null,
    has("medications") ? one("patient_medications") : null,
    has("obstetric_history") ? one("patient_obstetric_history") : null,
    has("investigations")
      ? supabase.from("investigation_results").select("type_code, value_numeric, value_text, unit, result_date").eq("patient_id", patientId).order("result_date", { ascending: false }).limit(200).then((r) => (r.data ?? []) as Row[])
      : null,
    supabase.from("investigation_types").select("code, name_en, name_ar, unit").then((r) => (r.data ?? []) as Row[]),
    has("appointments")
      ? supabase.from("appointments").select("scheduled_at, status, visit_type, doctor:doctors(display_name_en, display_name_ar)").eq("patient_id", patientId).order("scheduled_at", { ascending: false }).limit(15).then((r) => (r.data ?? []) as Row[])
      : null,
    has("visits") || has("treatment_plans")
      ? supabase.from("visits").select("id, visit_date, visit_type, status, doctor:doctors(display_name_en, display_name_ar)").eq("patient_id", patientId).neq("status", "cancelled").order("visit_date", { ascending: false }).limit(30).then((r) => (r.data ?? []) as Row[])
      : null,
    has("pregnancy") ? supabase.from("pregnancy_cases").select("case_number, status, lmp, edd, gravida, para, outcome, opened_at, closed_at").eq("patient_id", patientId).order("opened_at", { ascending: false }).then((r) => (r.data ?? []) as Row[]) : null,
    has("fertility") ? supabase.from("fertility_cases").select("case_number, status, infertility_type, duration_years, opened_at, closed_at").eq("patient_id", patientId).order("opened_at", { ascending: false }).then((r) => (r.data ?? []) as Row[]) : null,
    has("gynecology") || has("treatment_plans")
      ? supabase.from("gynecology_visits").select("visit_id, complaint, plan, visits!inner(patient_id, visit_date, status)").eq("visits.patient_id", patientId).neq("visits.status", "cancelled").limit(30).then((r) => (r.data ?? []) as Row[])
      : null,
    has("documents") ? supabase.from("documents").select("title, file_name, category, uploaded_at").eq("patient_id", patientId).eq("status", "active").order("uploaded_at", { ascending: false }).limit(50).then((r) => (r.data ?? []) as Row[]) : null,
    loadDoctor(patient.assigned_doctor_id),
  ])

  const typeName = (code: string) => {
    const ty = types.find((x) => x.code === code)
    return ty ? String((ar ? ty.name_ar : ty.name_en) ?? code) : code
  }
  const docName = (d: unknown) => {
    const x = d as { display_name_en?: string; display_name_ar?: string | null } | null
    return x ? (ar ? x.display_name_ar || x.display_name_en : x.display_name_en) ?? "" : ""
  }
  const yn = (v: unknown) => yesNo(v as boolean | null, { yes: tc("yes"), no: tc("no") })

  return (
    <ReportDocument type="patient_summary" patient={patient} doctor={doctor}>
      {full && (
        <ReportSection title={t("sections.patient")}>
          <KeyValues
            items={[
              [t("fields.fullName"), s(full.full_name)],
              [t("patientId"), s(full.patient_code)],
              [t("dob"), full.dob ? formatDate(String(full.dob)) : null],
              [t("fields.phone"), s(full.phone)],
              [t("fields.email"), s(full.email)],
              [t("fields.occupation"), s(full.occupation)],
              [t("fields.address"), s(full.address)],
              [t("fields.marriageDate"), full.marriage_date ? formatDate(String(full.marriage_date)) : null],
              [t("fields.bloodGroup"), [full.blood_group, full.rh].filter(Boolean).join(" ") || null],
            ]}
          />
        </ReportSection>
      )}
      {husband && (
        <ReportSection title={t("sections.partner")}>
          <KeyValues
            items={[
              [t("fields.fullName"), s(husband.full_name)],
              [t("dob"), husband.dob ? formatDate(String(husband.dob)) : null],
              [t("fields.phone"), s(husband.phone)],
              [t("fields.occupation"), s(husband.occupation)],
              [t("fields.bloodGroup"), [husband.blood_group, husband.rh].filter(Boolean).join(" ") || null],
            ]}
          />
        </ReportSection>
      )}
      {med && (
        <ReportSection title={t("sections.medical_history")}>
          <KeyValues items={[["HT", yn(med.ht)], ["DM", yn(med.dm)], [t("fields.hypothyroidism"), yn(med.hypothyroidism)], [t("fields.notes"), s(med.notes)]]} />
        </ReportSection>
      )}
      {surg && (
        <ReportSection title={t("sections.surgical_history")}>
          <p className="whitespace-pre-wrap">{s(surg.notes) ?? "—"}</p>
        </ReportSection>
      )}
      {allergy && (
        <ReportSection title={t("sections.allergies")}>
          <p className={allergy.allergy ? "font-bold" : ""}>{s(allergy.allergy) ?? t("noKnownAllergy")}</p>
        </ReportSection>
      )}
      {family && (
        <ReportSection title={t("sections.family_history")}>
          <KeyValues items={[["DM", yn(family.dm)], ["HT", yn(family.ht)], [t("fields.thrombosis"), yn(family.thrombosis)], [t("fields.cancer"), yn(family.cancer)], [t("fields.notes"), s(family.notes)]]} />
        </ReportSection>
      )}
      {meds && (
        <ReportSection title={t("sections.medications")}>
          <p className="whitespace-pre-wrap">{s(meds.notes) ?? "—"}</p>
        </ReportSection>
      )}
      {obst && (
        <ReportSection title={t("sections.obstetric_history")}>
          <KeyValues
            items={[
              ["G", s(obst.gravida)],
              ["P", s(obst.para)],
              [t("fields.abortions"), s(obst.abortions)],
              [t("fields.living"), [obst.living_male, obst.living_female].some((x) => x != null) ? `♂ ${obst.living_male ?? 0} · ♀ ${obst.living_female ?? 0}` : null],
              [t("fields.cSections"), s(obst.c_sections)],
              [t("fields.lastDelivery"), obst.last_delivery_date ? formatDate(String(obst.last_delivery_date)) : null],
              [t("fields.notes"), s(obst.notes)],
            ]}
          />
        </ReportSection>
      )}
      {results && (
        <ReportSection title={t("sections.investigations")}>
          <ReportTable
            head={[t("fields.test"), t("fields.result"), t("fields.date")]}
            rows={results.map((r) => [typeName(String(r.type_code)), [r.value_numeric ?? r.value_text, r.unit].filter((x) => x != null && x !== "").join(" "), formatDate(String(r.result_date))])}
            empty={t("none")}
          />
        </ReportSection>
      )}
      {appts && (
        <ReportSection title={t("sections.appointments")}>
          <ReportTable
            head={[t("fields.date"), t("fields.type"), t("doctor"), t("fields.status")]}
            rows={appts.map((a) => [formatDateTime(String(a.scheduled_at), locale), tt.has(`subtype.${a.visit_type}`) ? tt(`subtype.${a.visit_type}`) : String(a.visit_type), docName(a.doctor), tt.has(`status.${a.status}`) ? tt(`status.${a.status}`) : String(a.status)])}
            empty={t("none")}
          />
        </ReportSection>
      )}
      {visits && has("visits") && (
        <ReportSection title={t("sections.visits")}>
          <ReportTable
            head={[t("fields.date"), t("fields.type"), t("doctor"), t("fields.status")]}
            rows={visits.map((v) => [formatDate(String(v.visit_date)), tt.has(`subtype.${v.visit_type}`) ? tt(`subtype.${v.visit_type}`) : String(v.visit_type), docName(v.doctor), tt.has(`status.${v.status}`) ? tt(`status.${v.status}`) : String(v.status)])}
            empty={t("none")}
          />
        </ReportSection>
      )}
      {pregnancies && (
        <ReportSection title={t("sections.pregnancy")}>
          <ReportTable
            head={["#", "LMP", "EDD", "G / P", t("fields.status"), t("fields.outcome")]}
            rows={pregnancies.map((p) => [String(p.case_number), p.lmp ? formatDate(String(p.lmp)) : "—", p.edd ? formatDate(String(p.edd)) : "—", `${p.gravida ?? "—"} / ${p.para ?? "—"}`, tt.has(`status.${p.status}`) ? tt(`status.${p.status}`) : String(p.status), s(p.outcome) ?? "—"])}
            empty={t("none")}
          />
        </ReportSection>
      )}
      {fertility && (
        <ReportSection title={t("sections.fertility")}>
          <ReportTable
            head={["#", t("fields.infertilityType"), t("fields.duration"), t("fields.opened"), t("fields.status")]}
            rows={fertility.map((f) => [String(f.case_number), f.infertility_type ? t(`infertility.${f.infertility_type}`) : "—", f.duration_years != null ? t("years", { n: Number(f.duration_years) }) : "—", messageDate(String(f.opened_at)), tt.has(`status.${f.status}`) ? tt(`status.${f.status}`) : String(f.status)])}
            empty={t("none")}
          />
        </ReportSection>
      )}
      {gyn && has("gynecology") && (
        <ReportSection title={t("sections.gynecology")}>
          <ReportTable
            head={[t("fields.date"), t("fields.complaint")]}
            rows={gyn.map((g) => [formatDate(String((g.visits as Row).visit_date)), s(g.complaint) ?? "—"])}
            empty={t("none")}
          />
        </ReportSection>
      )}
      {has("treatment_plans") && (
        <ReportSection title={t("sections.treatment_plans")}>
          <ReportTable
            head={[t("fields.date"), t("fields.plan")]}
            rows={(gyn ?? []).filter((g) => g.plan).map((g) => [formatDate(String((g.visits as Row).visit_date)), String(g.plan)])}
            empty={t("none")}
          />
        </ReportSection>
      )}
      {docs && (
        <ReportSection title={t("sections.documents")}>
          <ReportTable
            head={[t("fields.date"), t("fields.document"), t("fields.type")]}
            rows={docs.map((d) => [messageDate(String(d.uploaded_at)), String(d.title ?? d.file_name), tt.has(`subtype.${d.category}`) ? tt(`subtype.${d.category}`) : String(d.category)])}
            empty={t("none")}
          />
        </ReportSection>
      )}
    </ReportDocument>
  )
}
