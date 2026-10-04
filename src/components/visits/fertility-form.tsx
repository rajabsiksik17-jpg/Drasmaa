"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { FileUp, HeartPulse, Loader2, Printer } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useRecord, type RecordController } from "@/hooks/use-record"
import { ConflictBanner } from "@/components/forms/conflict-banner"
import { useRecordLocked } from "@/components/forms/correction-context"
import {
  Calculated,
  MedicalDateInput,
  MedicalInput,
  MedicalNumberInput,
  MedicalRadioGroup,
  MedicalSelect,
  MedicalTextarea,
} from "@/components/medical/medical-fields"
import { PaperHeading, PaperLine, PaperRule, PaperSheet } from "@/components/medical/paper"
import { ResultField } from "@/components/visits/visit-results"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { DocumentLink } from "@/components/documents/document-link"
import { useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { createIvfConsent, startOiCycle } from "@/lib/actions/clinical"
import { linkConsentDocument } from "@/lib/actions/documents"
import { daysBetween, clinicToday, formatDate, formatDateTime, isoToClinicParts } from "@/lib/dates"
import type { VisitBundle } from "@/lib/data/visit"
import type { FertilityHusbandData, FertilityVisit, FertilityWifeData, IvfConsent, Patient } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

const PLANS = [
  { value: "oi", label: "O/I" },
  { value: "iui", label: "IUI" },
  { value: "ivf", label: "IVF" },
]

export function FertilityForm({
  patientRec,
  data,
  patientId,
  visitId,
  canEdit,
  canOi,
  canUpload,
}: {
  patientRec: RecordController<Patient>
  data: NonNullable<VisitBundle["fertility"]>
  patientId: string
  visitId: string
  canEdit: boolean
  canOi: boolean
  canUpload: boolean
}) {
  const t = useTranslations("fertility")
  const locale = useLocale()
  const refs = useRefs()
  const router = useRouter()
  const locked = useRecordLocked()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [upload, setUpload] = useState<null | "sfa" | { consentId: string }>(null)

  const fv = useRecord({ table: "fertility_visits", keyField: "visit_id", row: data.visit as FertilityVisit, readOnly: !canEdit })
  const husband = useRecord({ table: "fertility_husband_data", keyField: "visit_id", row: data.husband as FertilityHusbandData, readOnly: !canEdit })
  const wife = useRecord({ table: "fertility_wife_data", keyField: "visit_id", row: data.wife as FertilityWifeData, readOnly: !canEdit })

  const sfaDocs = data.documents.filter((d) => d.category === "sfa")
  const consentDocs = data.documents.filter((d) => d.category === "ivf_consent")
  const plans = [fv.values.plan_primary, fv.values.plan_secondary]
  const marriage = patientRec.values.marriage_date
  const marriedYears = marriage ? Math.floor(daysBetween(marriage, clinicToday()) / 365.25) : null
  const imported = !!fv.values.imported_from_visit_id

  const startCycle = () =>
    start(async () => {
      if (!data.fcase) return
      const res = await startOiCycle({ fertilityCaseId: data.fcase.id, visitId })
      if (!res.ok) return showError(res.error)
      toast.success(t("cycleReady", { number: res.data.cycle_number }))
      router.push(`/patients/${patientId}/cycles/${res.data.id}`)
    })

  const newConsent = () =>
    start(async () => {
      if (!data.fcase) return
      const res = await createIvfConsent({ patientId, fertilityCaseId: data.fcase.id, visitId })
      if (!res.ok) return showError(res.error)
      router.refresh()
    })

  return (
    <div className="space-y-3">
      <ConflictBanner rec={fv} />
      <ConflictBanner rec={husband} />
      <ConflictBanner rec={wife} />
      <PaperSheet className="text-[14.5px] leading-relaxed">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-[22px] font-bold">
            <span className="border-b-2 border-[color:var(--paper-line)] pb-0.5">Fertility</span>
          </h2>
          {data.fcase && <span className="text-[13px] text-[color:var(--paper-muted)]">{t("caseNumber", { number: data.fcase.case_number })}</span>}
        </div>

        <section id="fx-marital" className="scroll-mt-48 space-y-1">
          <PaperLine label="Marriage Date:">
            <span className="flex flex-wrap items-baseline gap-3">
              <MedicalDateInput rec={patientRec} field="marriage_date" label={t("marriageDate")} className="max-w-44" />
              {marriedYears != null && <Calculated label={t("marriedFor")} value={t("years", { count: marriedYears })} />}
            </span>
          </PaperLine>
          <PaperLine label="Causes of Infertility:" className="items-start">
            <MedicalTextarea rec={fv} field="causes_of_infertility" rows={2} label={t("causes")} />
          </PaperLine>
          {imported && <p className="text-[11px] text-[color:var(--paper-muted)]">{t("importedHint")}</p>}
        </section>

        <PaperRule />

        <section id="fx-panels" className="grid scroll-mt-48 gap-4 md:grid-cols-2">
          {/* Husband */}
          <div className="paper-box p-3">
            <PaperHeading className="text-[16px]">Husband</PaperHeading>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="paper-label font-bold">SFA</span>
              {canUpload && !locked && (
                <Button type="button" size="xs" variant="outline" className="no-print" onClick={() => setUpload("sfa")}>
                  <FileUp />
                  {t("uploadSfa")}
                </Button>
              )}
            </div>
            {sfaDocs.length > 0 ? (
              <ul className="mb-2 space-y-0.5 text-[12.5px]">
                {sfaDocs.slice(0, 4).map((d, i) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[color:var(--paper-fill)] px-1.5 text-[11px]">{i === 0 ? t("latest") : t("previous")}</span>
                    <DocumentLink documentId={d.id}>{d.title || d.file_name}</DocumentLink>
                    <span className="text-[color:var(--paper-muted)]">{formatDate(isoToClinicParts(d.uploaded_at).date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-[12.5px] text-[color:var(--paper-muted)]">{t("noSfa")}</p>
            )}
            <PaperLine label="Count:" dash><MedicalInput rec={husband} field="count" label={t("count")} /></PaperLine>
            <PaperLine label="Motility:" dash><MedicalInput rec={husband} field="motility" label={t("motility")} /></PaperLine>
            <PaperLine label="Morphology:" dash><MedicalInput rec={husband} field="morphology" label={t("morphology")} /></PaperLine>
            <PaperLine label="Viscosity:" dash><MedicalInput rec={husband} field="viscosity" label={t("viscosity")} /></PaperLine>
            <PaperLine label="WBC:" dash><MedicalInput rec={husband} field="wbc" label="WBC" /></PaperLine>
            <PaperLine label="Notes:" className="items-start"><MedicalTextarea rec={husband} field="notes" rows={2} label={t("husbandNotes")} /></PaperLine>
          </div>

          {/* Wife */}
          <div className="paper-box p-3">
            <PaperHeading className="text-[16px]">Wife</PaperHeading>
            <PaperLine label="Hormonal Profile:" className="items-start">
              <MedicalTextarea rec={wife} field="hormonal_profile" rows={1} label={t("hormonalProfile")} />
            </PaperLine>
            <div className="grid grid-cols-2 gap-x-4">
              <PaperLine label="AMH:" dash><ResultField code="amh" label="AMH" /></PaperLine>
              <PaperLine label="TSH:" dash><ResultField code="tsh" label="TSH" /></PaperLine>
              <PaperLine label="PRL:" dash><ResultField code="prl" label="PRL" /></PaperLine>
              <PaperLine label="Vit D:" dash><ResultField code="vitd" label="Vitamin D" /></PaperLine>
            </div>
            <PaperLine label="HSG:" dash>
              <MedicalRadioGroup
                rec={wife}
                field="hsg_result"
                label="HSG"
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "abnormal", label: "Abnormal" },
                ]}
              />
            </PaperLine>
            <PaperLine label="HSG Notes:" className="ms-3 text-[13px]"><MedicalInput rec={wife} field="hsg_notes" label={t("hsgNotes")} /></PaperLine>
            <PaperLine label="U/S:" dash><MedicalInput rec={wife} field="us" label="U/S" /></PaperLine>
            <PaperLine label="U/S Notes:" className="ms-3 text-[13px]"><MedicalInput rec={wife} field="us_notes" label={t("usNotes")} /></PaperLine>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 sm:grid-cols-3">
              <PaperLine label="AFC:" dash><MedicalNumberInput rec={wife} field="afc" min={0} max={200} label="AFC" className="w-14" /></PaperLine>
              <PaperLine label="Uterus:" dash>
                <MedicalSelect rec={wife} field="uterus" label={t("uterus")} options={refs.activeOptions("uterus_finding", wife.values.uterus)} />
              </PaperLine>
              <PaperLine label="ET:" dash><MedicalInput rec={wife} field="et" label="ET" /></PaperLine>
            </div>
            <PaperLine label="Notes:" className="items-start"><MedicalTextarea rec={wife} field="notes" rows={2} label={t("wifeNotes")} /></PaperLine>
          </div>
        </section>

        <section className="mt-4">
          <PaperLine label="Notes:" className="items-start">
            <MedicalTextarea rec={fv} field="notes" rows={2} label={t("notes")} />
          </PaperLine>
        </section>

        <PaperRule />

        <section id="fx-plan" className="scroll-mt-48">
          <PaperHeading>Plan</PaperHeading>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <PaperLine label={t("primaryPlan")}>
              <MedicalRadioGroup rec={fv} field="plan_primary" options={PLANS} label={t("primaryPlan")} />
            </PaperLine>
            <PaperLine label={t("secondPlan")}>
              <MedicalRadioGroup rec={fv} field="plan_secondary" options={PLANS} label={t("secondPlan")} />
            </PaperLine>
          </div>
          <PaperLine label={t("additionalNotes")} className="mt-1 items-start">
            <MedicalTextarea rec={fv} field="plan_notes" rows={2} label={t("additionalNotes")} />
          </PaperLine>
          <p className="mt-1 text-[11px] text-[color:var(--paper-muted)]">{t("noRecommendation")}</p>

          <AnimatePresence>
            {plans.includes("oi") && canOi && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="no-print mt-3">
                {data.activeCycle ? (
                  <Button size="sm" asChild>
                    <Link href={`/patients/${patientId}/cycles/${data.activeCycle.id}`}>
                      <HeartPulse />
                      {t("openCycle", { number: data.activeCycle.cycle_number })}
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" onClick={startCycle} disabled={pending || !data.fcase}>
                    {pending ? <Loader2 className="animate-spin" /> : <HeartPulse />}
                    {t("startCycle")}
                  </Button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <AnimatePresence>
          {plans.includes("ivf") && (
            <motion.section
              id="fx-consent"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="scroll-mt-48 overflow-hidden"
            >
              <PaperRule />
              <PaperHeading>IVF Consent</PaperHeading>
              <div className="space-y-3">
                {data.consents.map((c) => (
                  <ConsentRow
                    key={c.id}
                    consent={c}
                    canEdit={canEdit}
                    onUpload={() => setUpload({ consentId: c.id })}
                    canUpload={canUpload && !locked}
                    printHref={`/print/consent/${c.id}`}
                    document={consentDocs.find((d) => d.id === c.document_id) ?? null}
                    locale={locale}
                  />
                ))}
                {canEdit && !locked && (
                  <Button size="sm" variant="outline" className="no-print" onClick={newConsent} disabled={pending || !data.fcase}>
                    {t("newConsent")}
                  </Button>
                )}
                <PaperLine label={t("consentNotes")} className="items-start">
                  <MedicalTextarea rec={fv} field="ivf_consent_notes" rows={2} label={t("consentNotes")} />
                </PaperLine>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </PaperSheet>

      {upload && (
        <UploadDialog
          open
          onOpenChange={(o) => !o && setUpload(null)}
          lockCategory
          defaultCategory={upload === "sfa" ? "sfa" : "ivf_consent"}
          links={{ patientId, visitId, fertilityCaseId: data.fcase?.id ?? null }}
          onUploaded={async (docId) => {
            if (upload !== "sfa") {
              const res = await linkConsentDocument(upload.consentId, docId)
              if (!res.ok) showError(res.error)
            }
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function ConsentRow({
  consent,
  canEdit,
  canUpload,
  onUpload,
  printHref,
  document,
  locale,
}: {
  consent: IvfConsent
  canEdit: boolean
  canUpload: boolean
  onUpload: () => void
  printHref: string
  document: { id: string; file_name: string; uploaded_at: string } | null
  locale: string
}) {
  const t = useTranslations("fertility")
  const rec = useRecord({ table: "ivf_consents", keyField: "id", row: consent, readOnly: !canEdit })
  return (
    <div className="paper-box space-y-2 p-3 text-[13.5px]">
      <ConflictBanner rec={rec} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <MedicalRadioGroup
          rec={rec}
          field="technique"
          label={t("technique")}
          options={[
            { value: "classic", label: t("classic") },
            { value: "icsi", label: t("icsi") },
          ]}
        />
        <MedicalRadioGroup
          rec={rec}
          field="surplus_embryos"
          label={t("surplus")}
          options={[
            { value: "freeze", label: t("freeze") },
            { value: "discard", label: t("discard") },
          ]}
        />
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            className="paper-check"
            checked={!!rec.values.genetic_testing}
            disabled={rec.readOnly}
            onChange={(e) => rec.set("genetic_testing", e.target.checked)}
          />
          {t("pgt")}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <PaperLine label={t("consentDate")}>
          <MedicalDateInput rec={rec} field="consent_date" label={t("consentDate")} />
        </PaperLine>
        <span className="text-[12px]">
          {t(`consentStatus.${rec.values.status}`)}
          {document && (
            <>
              {" · "}
              <DocumentLink documentId={document.id}>{document.file_name}</DocumentLink>
              <span className="text-[color:var(--paper-muted)]"> · {formatDateTime(document.uploaded_at, locale)}</span>
            </>
          )}
        </span>
        <div className="no-print ms-auto flex gap-1.5">
          <Button size="xs" variant="outline" asChild>
            <a href={printHref} target="_blank" rel="noopener">
              <Printer />
              {t("printConsent")}
            </a>
          </Button>
          {canUpload && (
            <Button size="xs" variant="outline" onClick={onUpload}>
              <FileUp />
              {t("uploadSigned")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
