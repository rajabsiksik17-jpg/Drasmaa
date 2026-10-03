"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { FileSignature, Loader2, UserPlus, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DateInput } from "@/components/common/date-input"
import { PageHeader, SectionCard } from "@/components/common/page"
import { PatientPicker, type PickedPatient } from "@/components/patients/patient-picker"
import { useActionError } from "@/hooks/use-action-error"
import { createReport } from "@/lib/actions/reports"
import { cn } from "@/lib/utils"
import type { ReportLanguage, ReportTemplate } from "@/types/db"

export function NewReportForm({
  templates,
  patient,
  visitId,
}: {
  templates: ReportTemplate[]
  patient: { id: string; full_name: string; patient_code: string } | null
  visitId: string | null
}) {
  const t = useTranslations("medicalReports")
  const locale = useLocale()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<"patient" | "standalone">(patient ? "patient" : "patient")
  const [picked, setPicked] = useState<PickedPatient | null>(patient ? { id: patient.id, full_name: patient.full_name, patient_code: patient.patient_code } : null)
  const [subject, setSubject] = useState({ name: "", dob: null as string | null, age: "", country: "", reference: "" })
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "")
  const [language, setLanguage] = useState<ReportLanguage>(locale === "ar" ? "ar" : "en")

  const create = () =>
    start(async () => {
      const res = await createReport({
        patientId: mode === "patient" ? (picked?.id ?? null) : null,
        visitId,
        templateId: templateId || null,
        language,
        subject:
          mode === "standalone"
            ? { name: subject.name, dob: subject.dob, age: subject.age ? Number(subject.age) : null, country: subject.country || null, reference: subject.reference || null }
            : undefined,
      })
      if (!res.ok) return showError(res.error)
      router.push(`/reports/${res.data.id}`)
    })

  const valid = mode === "patient" ? !!picked : subject.name.trim().length >= 2

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t("new")} description={t("newHint")} breadcrumbs={[{ href: "/reports", label: t("title") }, { label: t("new") }]} />

      <SectionCard title={t("person")} icon={UserRound}>
        {!patient && (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
            {(["patient", "standalone"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn("inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium", mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {m === "patient" ? <UserRound className="size-4" /> : <UserPlus className="size-4" />}
                {t(`modes.${m}`)}
              </button>
            ))}
          </div>
        )}
        {mode === "patient" ? (
          patient ? (
            <p className="text-sm">
              <b>{patient.full_name}</b> · {patient.patient_code}
            </p>
          ) : (
            <PatientPicker value={picked} onChange={setPicked} />
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="rp-name">{t("fields.fullName")}</Label>
              <Input id="rp-name" dir="auto" value={subject.name} onChange={(e) => setSubject({ ...subject, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("fields.dob")}</Label>
              <DateInput value={subject.dob} onChange={(v) => setSubject({ ...subject, dob: v })} aria-label={t("fields.dob")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rp-age">{t("fields.age")}</Label>
              <Input id="rp-age" type="number" min={0} max={130} dir="ltr" value={subject.age} onChange={(e) => setSubject({ ...subject, age: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rp-country">{t("fields.country")}</Label>
              <Input id="rp-country" dir="auto" value={subject.country} onChange={(e) => setSubject({ ...subject, country: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rp-ref">{t("fields.reference")}</Label>
              <Input id="rp-ref" dir="ltr" value={subject.reference} onChange={(e) => setSubject({ ...subject, reference: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("standaloneHint")}</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("templateAndLanguage")} icon={FileSignature}>
        <div className="space-y-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {templates.map((tp) => (
              <li key={tp.id}>
                <button
                  type="button"
                  onClick={() => setTemplateId(tp.id)}
                  className={cn("w-full rounded-lg border px-3 py-2 text-start text-sm transition", templateId === tp.id ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20" : "hover:bg-muted/50")}
                >
                  <span className="block font-medium">{locale === "ar" ? tp.name_ar : tp.name_en}</span>
                  <span className="block text-xs text-muted-foreground">{t(`types.${tp.report_type}`)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t("language")}</span>
            {(["ar", "en", "bilingual"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", language === l ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {t(`languages.${l}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("noTranslation")}</p>
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <Button onClick={create} disabled={!valid || pending}>
          {pending && <Loader2 className="animate-spin" />}
          {t("createAndEdit")}
        </Button>
      </div>
    </div>
  )
}
