"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Ban, CheckCircle2, Copy, History, Link2, Loader2, Save, UserRound, Variable } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/common/native-select"
import { DateInput } from "@/components/common/date-input"
import { PageHeader, SectionCard } from "@/components/common/page"
import { ReasonDialog } from "@/components/forms/correction-context"
import { PatientPicker, type PickedPatient } from "@/components/patients/patient-picker"
import { useRefs } from "@/components/app-context"
import { ExportMenu } from "@/components/documents/export-menu"
import { REPORT_TYPES, ReportStatusBadge } from "@/components/reports/reports-list"
import { useActionError } from "@/hooks/use-action-error"
import { duplicateReport, finalizeReport, linkReportToPatient, saveReport, voidReport } from "@/lib/actions/reports"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { MedicalReport, ReportLanguage } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

const VARIABLES = ["patient_name", "age", "date", "dob", "doctor_name", "specialization", "clinic_name", "patient_id", "reference", "country"] as const

/**
 * The report text belongs to the report (a snapshot): later changes to the
 * patient record never alter it. Drafts autosave; final reports are saved
 * explicitly and every change keeps the previous version.
 */
export function ReportEditor({
  report,
  versions,
  can,
}: {
  report: MedicalReport
  versions: { id: string; version_no: number; created_at: string; snapshot: MedicalReport }[]
  can: { edit: boolean; void: boolean; link: boolean; duplicate: boolean }
}) {
  const t = useTranslations("medicalReports")
  const locale = useLocale()
  const refs = useRefs()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [v, setV] = useState({
    language: report.language,
    report_date: report.report_date,
    title: report.title ?? "",
    recipient: report.recipient ?? "",
    subject_name: report.subject_name,
    subject_dob: report.subject_dob,
    subject_age: report.subject_age != null ? String(report.subject_age) : "",
    subject_country: report.subject_country ?? "",
    subject_reference: report.subject_reference ?? "",
    doctor_id: report.doctor_id ?? "",
    body_en: report.body_en,
    body_ar: report.body_ar,
    report_type: report.report_type,
  })
  const [status, setStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle")
  const version = useRef(report.version)
  const latest = useRef(v)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFocused = useRef<{ el: HTMLTextAreaElement; key: "body_en" | "body_ar" } | null>(null)
  const [voidOpen, setVoidOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkTo, setLinkTo] = useState<PickedPatient | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const isFinal = report.status === "final"
  const readOnly = !can.edit

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    const x = latest.current
    setStatus("saving")
    const res = await saveReport({
      id: report.id,
      expectedVersion: version.current,
      language: x.language,
      report_date: x.report_date,
      title: x.title || null,
      recipient: x.recipient || null,
      subject_name: x.subject_name,
      subject_dob: x.subject_dob,
      subject_age: x.subject_age ? Number(x.subject_age) : null,
      subject_country: x.subject_country || null,
      subject_reference: x.subject_reference || null,
      doctor_id: x.doctor_id || null,
      body_en: x.body_en,
      body_ar: x.body_ar,
      report_type: x.report_type,
    })
    if (!res.ok) {
      setStatus("error")
      showError(res.error)
      return false
    }
    version.current = res.data.version
    setStatus("saved")
    return true
  }, [report.id, showError])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const update = (patch: Partial<typeof v>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setV(next)
    setStatus("pending")
    if (!isFinal) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), 1200)
    }
  }

  const insertVariable = (name: string) => {
    const target = lastFocused.current
    const token = `{{${name}}}`
    const key = target?.key ?? (v.language === "ar" ? "body_ar" : "body_en")
    if (!target) return update({ [key]: `${latest.current[key]}${token}` })
    const { el } = target
    const s = el.selectionStart ?? el.value.length
    const e = el.selectionEnd ?? s
    update({ [key]: el.value.slice(0, s) + token + el.value.slice(e) })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + token.length, s + token.length)
    })
  }

  const finalize = () =>
    start(async () => {
      if (status === "pending" && !(await save())) return
      const res = await finalizeReport(report.id, version.current)
      if (!res.ok) return showError(res.error)
      toast.success(t("finalized"))
      router.refresh()
    })

  const body = (key: "body_en" | "body_ar") => (
    <div className="grid gap-1.5">
      <Label htmlFor={`rb-${key}`}>{key === "body_ar" ? t("bodyAr") : t("bodyEn")}</Label>
      <Textarea
        id={`rb-${key}`}
        dir={key === "body_ar" ? "rtl" : "ltr"}
        lang={key === "body_ar" ? "ar" : "en"}
        value={v[key]}
        readOnly={readOnly}
        onFocus={(e) => (lastFocused.current = { el: e.currentTarget, key })}
        onChange={(e) => update({ [key]: e.target.value })}
        className="min-h-80 text-[15px] leading-7"
      />
    </div>
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        breadcrumbs={[{ href: "/reports", label: t("title") }, { label: report.report_number }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{report.report_number}</span>
            <ReportStatusBadge status={report.status} />
          </span>
        }
        description={
          report.patient_id ? (
            <Link href={`/patients/${report.patient_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <UserRound className="size-3.5" />
              {report.subject_name} · {report.subject_patient_code}
            </Link>
          ) : (
            <span>
              {report.subject_name} · {t("standalone")}
            </span>
          )
        }
        actions={
          <>
            <span className="text-xs text-muted-foreground">
              {status === "saving" ? t("saving") : status === "pending" ? (isFinal ? t("unsavedFinal") : t("unsaved")) : status === "saved" ? t("saved") : status === "error" ? t("saveError") : ""}
            </span>
            {isFinal && can.edit && status === "pending" && (
              <Button size="sm" onClick={() => start(async () => void ((await save()) && router.refresh()))} disabled={pending}>
                <Save />
                {t("saveVersion")}
              </Button>
            )}
            {report.status === "draft" && can.edit && (
              <Button size="sm" onClick={finalize} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                {t("finalize")}
              </Button>
            )}
            {report.status !== "void" && <ExportMenu target={{ type: "medical_report", entityId: report.id, patientId: report.patient_id }} size="default" />}
            {can.duplicate && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  start(async () => {
                    const res = await duplicateReport(report.id)
                    if (!res.ok) return showError(res.error)
                    router.push(`/reports/${res.data.id}`)
                  })
                }
              >
                <Copy />
                {t("duplicate")}
              </Button>
            )}
            {can.link && (
              <Button size="sm" variant="ghost" onClick={() => setLinkOpen(true)}>
                <Link2 />
                {t("linkPatient")}
              </Button>
            )}
            {versions.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
                <History />
                {t("versions", { count: versions.length })}
              </Button>
            )}
            {can.void && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidOpen(true)}>
                <Ban />
                {t("void")}
              </Button>
            )}
          </>
        }
      />

      {report.status === "void" && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("voidedBecause", { reason: report.void_reason ?? "" })}</p>}
      {isFinal && can.edit && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t("finalEditHint")}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <SectionCard>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="r-title">{t("fields.title")}</Label>
                <Input id="r-title" dir="auto" value={v.title} readOnly={readOnly} onChange={(e) => update({ title: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="r-recipient">{t("fields.recipient")}</Label>
                <Input id="r-recipient" dir="auto" value={v.recipient} readOnly={readOnly} onChange={(e) => update({ recipient: e.target.value })} />
              </div>
            </div>
          </SectionCard>
          <SectionCard>
            <div className="space-y-4">
              {v.language !== "ar" && body("body_en")}
              {v.language !== "en" && body("body_ar")}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={t("details")}>
            <div className="space-y-3 text-sm">
              <div className="grid gap-1">
                <Label>{t("language")}</Label>
                <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
                  {(["ar", "en", "bilingual"] as ReportLanguage[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      disabled={readOnly}
                      onClick={() => update({ language: l })}
                      className={cn("rounded-md py-1 text-xs font-medium", v.language === l ? "bg-background shadow-sm" : "text-muted-foreground")}
                    >
                      {t(`languages.${l}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1">
                <Label>{t("date")}</Label>
                <DateInput value={v.report_date} onChange={(d) => d && update({ report_date: d })} disabled={readOnly} aria-label={t("date")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="r-type">{t("type")}</Label>
                <NativeSelect id="r-type" value={v.report_type} disabled={readOnly} onChange={(e) => update({ report_type: e.target.value })}>
                  {REPORT_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`types.${x}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="r-doctor">{t("doctor")}</Label>
                <NativeSelect id="r-doctor" value={v.doctor_id} disabled={readOnly} onChange={(e) => update({ doctor_id: e.target.value })}>
                  <option value="">—</option>
                  {refs.activeDoctors(v.doctor_id).map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={t("person")}>
            <div className="space-y-2 text-sm">
              <div className="grid gap-1">
                <Label htmlFor="r-name">{t("fields.fullName")}</Label>
                <Input id="r-name" dir="auto" value={v.subject_name} readOnly={readOnly || !!report.patient_id} onChange={(e) => update({ subject_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label>{t("fields.dob")}</Label>
                  <DateInput value={v.subject_dob} onChange={(d) => update({ subject_dob: d })} disabled={readOnly || !!report.patient_id} aria-label={t("fields.dob")} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="r-age">{t("fields.age")}</Label>
                  <Input id="r-age" type="number" dir="ltr" value={v.subject_age} readOnly={readOnly} onChange={(e) => update({ subject_age: e.target.value })} />
                </div>
              </div>
              {!report.patient_id && (
                <>
                  <div className="grid gap-1">
                    <Label htmlFor="r-country">{t("fields.country")}</Label>
                    <Input id="r-country" dir="auto" value={v.subject_country} readOnly={readOnly} onChange={(e) => update({ subject_country: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="r-ref">{t("fields.reference")}</Label>
                    <Input id="r-ref" dir="ltr" value={v.subject_reference} readOnly={readOnly} onChange={(e) => update({ subject_reference: e.target.value })} />
                  </div>
                </>
              )}
              {report.patient_id && <p className="text-[11px] text-muted-foreground">{t("snapshotHint")}</p>}
            </div>
          </SectionCard>

          {!readOnly && (
            <SectionCard title={t("variables")} icon={Variable}>
              <div className="flex flex-wrap gap-1">
                {VARIABLES.map((x) => (
                  <button key={x} type="button" onClick={() => insertVariable(x)} className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary">
                    {t(`vars.${x}`)}
                  </button>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <ReasonDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        onConfirm={(r) =>
          start(async () => {
            const res = await voidReport(report.id, r)
            if (!res.ok) return showError(res.error)
            toast.success(t("voided"))
            router.refresh()
          })
        }
      />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("linkPatient")}</DialogTitle>
            <DialogDescription>{t("linkHint")}</DialogDescription>
          </DialogHeader>
          <PatientPicker value={linkTo} onChange={setLinkTo} />
          <Button
            disabled={!linkTo || pending}
            onClick={() =>
              start(async () => {
                if (!linkTo) return
                const res = await linkReportToPatient(report.id, linkTo.id)
                if (!res.ok) return showError(res.error)
                setLinkOpen(false)
                toast.success(t("linked"))
                router.refresh()
              })
            }
          >
            {t("link")}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("history")}</DialogTitle>
            <DialogDescription>{t("historyHint")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-3">
            {versions.map((x) => (
              <li key={x.id} className="rounded-lg border p-3">
                <p className="text-xs font-medium">
                  {t("versionNo", { n: x.version_no })} · {formatDateTime(x.created_at, locale)}
                </p>
                <p className="mt-1 line-clamp-6 text-xs whitespace-pre-wrap text-muted-foreground" dir="auto">
                  {x.snapshot.body_en || x.snapshot.body_ar}
                </p>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}
