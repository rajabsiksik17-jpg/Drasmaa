"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Lock, PencilLine } from "lucide-react"
import { useRecord, type RecordController } from "@/hooks/use-record"
import { ConflictBanner } from "@/components/forms/conflict-banner"
import { ReasonDialog, ReasonScope, useRecordLocked } from "@/components/forms/correction-context"
import { Calculated, MedicalDateInput, MedicalNumberInput, MedicalTextarea } from "@/components/medical/medical-fields"
import { PaperSheet } from "@/components/medical/paper"
import { useRefs } from "@/components/app-context"
import { formatDate } from "@/lib/dates"
import { eddFromLmp, formatBp, gestationalAge, parseBp } from "@/lib/medical/calculations"
import { cn } from "@/lib/utils"
import type { PregnancyCase, PregnancyFollowup } from "@/types/db"

export interface PregnancyCardPatient {
  full_name: string
  age: number | null
  patient_code: string
  wifeBlood: string
  husbandBlood: string
}

/**
 * Digital "Pregnancy follow-up" card (paper form v1): identification block,
 * History box, and the Visit#/Date/Wt./B/P/Complaint/U/S/Lab./Plan table.
 * Each visit adds a row; earlier rows are never silently rewritten.
 */
export function PregnancyCard({
  pcase,
  followups,
  patient,
  editableRowIds,
  canEditCase,
  canCorrect,
}: {
  pcase: PregnancyCase
  followups: PregnancyFollowup[]
  patient: PregnancyCardPatient
  /** Rows that belong to a still-open visit (editable without a reason). */
  editableRowIds: string[]
  canEditCase: boolean
  canCorrect: boolean
}) {
  const t = useTranslations("pregnancy")
  const refs = useRefs()
  const caseRec = useRecord({ table: "pregnancy_cases", keyField: "id", row: pcase, readOnly: !canEditCase })
  const lmp = caseRec.values.lmp
  const calcEdd = eddFromLmp(lmp)

  return (
    <div className="space-y-3">
      <ConflictBanner rec={caseRec} />
      <PaperSheet orientation="landscape" className="text-[14px]">
        {/* Header block + History box */}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_32%]">
          <div className="paper-box divide-y divide-[color:var(--paper-line)]">
            <div className="flex flex-wrap items-baseline gap-x-4 px-2 py-1">
              <span className="paper-label">Name:</span>
              <span className="min-w-0 flex-1 border-b border-dotted border-[#6b6b6b] px-1 font-medium">{patient.full_name}</span>
              <span className="paper-label">Age:</span>
              <span className="w-10 border-b border-dotted border-[#6b6b6b] px-1 text-center">{patient.age ?? ""}</span>
              <span className="paper-label">File #</span>
              <span className="w-24 border-b border-dotted border-[#6b6b6b] px-1 font-mono text-[12px]">{patient.patient_code}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 px-2 py-1">
              <span className="paper-label">Blood Group &amp; Rh (Wife)</span>
              <span className="min-w-16 flex-1 border-b border-dotted border-[#6b6b6b] px-1">{patient.wifeBlood}</span>
              <span className="paper-label">/ (Husband)</span>
              <span className="min-w-16 flex-1 border-b border-dotted border-[#6b6b6b] px-1">{patient.husbandBlood}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-6 px-2 py-1">
              <span className="inline-flex items-baseline gap-2">
                <span className="paper-label">LMP:</span>
                <MedicalDateInput rec={caseRec} field="lmp" label="LMP" className="w-40" />
              </span>
              <span className="inline-flex items-baseline gap-2">
                <span className="paper-label">EDD:</span>
                <MedicalDateInput rec={caseRec} field="edd" label="EDD" className="w-40" />
                {!caseRec.values.edd && calcEdd && <Calculated label="" value={formatDate(calcEdd)} title={t("eddCalculated")} />}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-6 px-2 py-1">
              <span className="inline-flex items-baseline gap-2">
                <span className="paper-label">Gravida:</span>
                <MedicalNumberInput rec={caseRec} field="gravida" min={0} max={30} label="Gravida" className="w-14" />
              </span>
              <span className="inline-flex items-baseline gap-2">
                <span className="paper-label">Para:</span>
                <MedicalNumberInput rec={caseRec} field="para" min={0} max={30} label="Para" className="w-14" />
              </span>
              <span className="ms-auto text-[12px] text-[color:var(--paper-muted)]">{t("caseNumber", { number: pcase.case_number })}</span>
            </div>
          </div>
          <div className="paper-box flex min-h-32 flex-col p-2">
            <span className="paper-label">History:</span>
            <MedicalTextarea rec={caseRec} field="history" rows={3} label={t("history")} className="flex-1" />
            <span className="mt-1 self-start text-[10px] italic text-[color:var(--paper-muted)]">{refs.clinicName}</span>
          </div>
        </div>

        {/* Follow-up table */}
        <div className="scroll-x mt-3">
          <table className="paper-grid w-full min-w-[900px] text-[13px]">
            <colgroup>
              <col style={{ width: "6%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "19%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "19%" }} />
            </colgroup>
            <thead>
              <tr className="bg-[#d9d9d9] text-[12.5px]">
                {["Visit #", "Date", "Wt.", "B/P", "Complaint", "U/S", "Lab.", "Plan"].map((h) => (
                  <th key={h} className="px-1 py-1 text-center font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {followups.map((f) => (
                <FollowupRow
                  key={f.id}
                  row={f}
                  lmp={lmp}
                  editable={editableRowIds.includes(f.id)}
                  canCorrect={canCorrect}
                />
              ))}
              {followups.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[color:var(--paper-muted)]">
                    {t("noFollowups")}
                  </td>
                </tr>
              )}
              {/* Blank ruled rows, as on the printed card */}
              {Array.from({ length: Math.max(0, 3 - followups.length) }, (_, i) => (
                <tr key={`blank-${i}`} aria-hidden className="h-14">
                  {Array.from({ length: 8 }, (_, j) => (
                    <td key={j} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PaperSheet>
    </div>
  )
}

function FollowupRow({
  row,
  lmp,
  editable,
  canCorrect,
}: {
  row: PregnancyFollowup
  lmp: string | null
  editable: boolean
  canCorrect: boolean
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [ask, setAsk] = useState(false)
  const outerLocked = useRecordLocked()
  const locked = (!editable && !reason) || (editable && outerLocked)
  return (
    <ReasonScope reason={reason} locked={locked}>
      <FollowupRowInner row={row} lmp={lmp} locked={locked} correcting={!!reason} onCorrect={canCorrect && !editable && !reason ? () => setAsk(true) : undefined} />
      <ReasonDialog open={ask} onOpenChange={setAsk} onConfirm={setReason} />
    </ReasonScope>
  )
}

function FollowupRowInner({
  row,
  lmp,
  locked,
  correcting,
  onCorrect,
}: {
  row: PregnancyFollowup
  lmp: string | null
  locked: boolean
  correcting: boolean
  onCorrect?: () => void
}) {
  const t = useTranslations("pregnancy")
  const rec = useRecord({ table: "pregnancy_followups", keyField: "id", row })
  const ga = gestationalAge(lmp, rec.values.followup_date)
  return (
    <>
      <tr className={cn("align-top", correcting && "bg-amber-50", !locked && !correcting && "bg-[#f4fbfc]")}>
        <td className="px-1 py-1 text-center font-semibold">
          {row.visit_no}
          <div className="no-print mt-1 flex justify-center">
            {locked ? (
              onCorrect ? (
                <button type="button" onClick={onCorrect} className="text-[color:var(--paper-muted)] hover:text-[#2a8a9b]" aria-label={t("correctRow")} title={t("correctRow")}>
                  <PencilLine className="size-3.5" />
                </button>
              ) : (
                <Lock className="size-3 text-[color:var(--paper-muted)]" aria-label={t("locked")} />
              )
            ) : null}
          </div>
        </td>
        <td className="px-0.5 py-0.5">
          <MedicalDateInput rec={rec} field="followup_date" label="Date" line={false} className="text-[12px]" />
          {ga && <div className="px-1 text-[10.5px] text-[color:var(--paper-muted)]">{t("ga", { weeks: ga.weeks, days: ga.days })}</div>}
        </td>
        <td className="px-0.5 py-0.5">
          <MedicalNumberInput rec={rec} field="weight_kg" integer={false} min={20} max={300} label={t("weight")} line={false} />
        </td>
        <td className="px-0.5 py-0.5">
          <BpInput rec={rec} />
        </td>
        <td className="px-0.5 py-0.5">
          <MedicalTextarea rec={rec} field="complaint" rows={2} label={t("complaint")} />
        </td>
        <td className="px-0.5 py-0.5">
          <MedicalTextarea rec={rec} field="ultrasound" rows={2} label="U/S" />
        </td>
        <td className="px-0.5 py-0.5">
          <MedicalTextarea rec={rec} field="lab" rows={2} label={t("lab")} />
        </td>
        <td className="px-0.5 py-0.5">
          <MedicalTextarea rec={rec} field="plan" rows={2} label={t("plan")} />
        </td>
      </tr>
      {rec.conflict && (
        <tr className="no-print">
          <td colSpan={8} className="p-1">
            <ConflictBanner rec={rec} />
          </td>
        </tr>
      )}
    </>
  )
}

/** "120/80" in one cell, stored as systolic + diastolic. */
function BpInput({ rec }: { rec: RecordController<PregnancyFollowup> }) {
  const t = useTranslations("pregnancy")
  const stored = formatBp(rec.values.bp_systolic, rec.values.bp_diastolic)
  // Raw text only while typing; otherwise reflect the stored value.
  const [typing, setTyping] = useState<string | null>(null)
  const text = typing ?? stored
  const invalid = typing != null && parseBp(typing) == null
  return (
    <input
      id={`bp-${rec.values.id}`}
      aria-label={t("bp")}
      aria-invalid={invalid || undefined}
      inputMode="numeric"
      placeholder="120/80"
      className={cn("paper-input paper-cell-input", invalid && "text-red-600")}
      value={text}
      disabled={rec.readOnly}
      onChange={(e) => {
        setTyping(e.target.value)
        const parsed = parseBp(e.target.value)
        if (parsed) rec.setMany({ bp_systolic: parsed.systolic, bp_diastolic: parsed.diastolic })
      }}
      onBlur={() => {
        if (typing == null || parseBp(typing)) setTyping(null)
      }}
    />
  )
}
