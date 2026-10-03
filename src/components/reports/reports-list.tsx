"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { FilePlus2, FileSignature, Search, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/common/native-select"
import { DateInput } from "@/components/common/date-input"
import { PageHeader } from "@/components/common/page"
import { useCan, useRefs } from "@/components/app-context"
import { ExportMenu } from "@/components/documents/export-menu"
import { formatDate } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"

export interface ReportListRow {
  id: string
  report_number: string
  report_date: string
  report_type: string
  language: "ar" | "en" | "bilingual"
  status: "draft" | "final" | "void"
  subject_name: string
  subject_patient_code: string | null
  patient_id: string | null
  created_by: string | null
  doctor: { display_name_en: string; display_name_ar: string | null } | null
}

export const REPORT_TYPES = ["general", "gynecology", "fertility", "pregnancy", "opinion", "referral", "certificate", "international", "followup", "custom"] as const

export function ReportStatusBadge({ status }: { status: ReportListRow["status"] }) {
  const t = useTranslations("medicalReports.status")
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "final" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : status === "void" ? "bg-destructive/12 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      )}
    >
      {t(status)}
    </span>
  )
}

export function ReportsList({ rows, filters, people }: { rows: ReportListRow[]; filters: Record<string, string>; people: Record<string, string> }) {
  const t = useTranslations("medicalReports")
  const locale = useLocale()
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [q, setQ] = useState(filters.q)
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    router.push(`${pathname}?${next}`)
  }
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          can(P.reportsCreate) && (
            <Button asChild>
              <Link href="/reports/new">
                <FilePlus2 />
                {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative w-full sm:w-64"
          onSubmit={(e) => {
            e.preventDefault()
            set("q", q.trim())
          }}
        >
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-8" />
        </form>
        <NativeSelect value={filters.type} onChange={(e) => set("type", e.target.value)} className="w-44" aria-label={t("type")}>
          <option value="">{t("allTypes")}</option>
          {REPORT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`types.${x}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={filters.language} onChange={(e) => set("language", e.target.value)} className="w-36" aria-label={t("language")}>
          <option value="">{t("allLanguages")}</option>
          {(["ar", "en", "bilingual"] as const).map((l) => (
            <option key={l} value={l}>
              {t(`languages.${l}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={filters.doctor} onChange={(e) => set("doctor", e.target.value)} className="w-44" aria-label={t("doctor")}>
          <option value="">{t("allDoctors")}</option>
          {refs.activeDoctors().map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </NativeSelect>
        <DateInput value={filters.from || null} onChange={(v) => set("from", v ?? "")} className="w-36" aria-label={t("from")} />
        <DateInput value={filters.to || null} onChange={(v) => set("to", v ?? "")} className="w-36" aria-label={t("to")} />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("number")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("person")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("doctor")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("type")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("language")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("statusLabel")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("createdBy")}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/40">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/reports/${r.id}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                    <FileSignature className="size-3.5" />
                    {r.report_number}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {r.subject_name}
                  {r.patient_id ? (
                    <Link href={`/patients/${r.patient_id}`} className="ms-1.5 inline-flex items-center gap-0.5 text-xs text-primary">
                      <UserRound className="size-3" />
                      {r.subject_patient_code}
                    </Link>
                  ) : (
                    <span className="ms-1.5 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{t("standalone")}</span>
                  )}
                </td>
                <td className="px-3 py-2">{formatDate(r.report_date)}</td>
                <td className="px-3 py-2">{r.doctor ? (locale === "ar" ? r.doctor.display_name_ar || r.doctor.display_name_en : r.doctor.display_name_en) : "—"}</td>
                <td className="px-3 py-2">{t(`types.${r.report_type}`)}</td>
                <td className="px-3 py-2">{t(`languages.${r.language}`)}</td>
                <td className="px-3 py-2">
                  <ReportStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.created_by ? people[r.created_by] : "—"}</td>
                <td className="px-2 py-1.5">{r.status !== "void" && <ExportMenu target={{ type: "medical_report", entityId: r.id, patientId: r.patient_id }} size="icon-sm" />}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
