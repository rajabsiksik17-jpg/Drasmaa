"use client"

import { useTranslations } from "next-intl"
import { useRecord, type RecordController } from "@/hooks/use-record"
import { ConflictBanner } from "@/components/forms/conflict-banner"
import {
  Calculated,
  MedicalDateInput,
  MedicalInput,
  MedicalNumberInput,
  MedicalSelect,
  MedicalTextarea,
  MedicalYesNo,
} from "@/components/medical/medical-fields"
import { PaperHeading, PaperLine, PaperRule, PaperSheet } from "@/components/medical/paper"
import { useRefs } from "@/components/app-context"
import { ageFromDob, formatDate } from "@/lib/dates"
import { eddFromLmp, lmpSummary } from "@/lib/medical/calculations"
import type {
  Patient,
  PatientAllergy,
  PatientFamilyHistory,
  PatientHusband,
  PatientMedicalHistory,
  PatientMenstrualHistory,
  PatientNotesRow,
  PatientObstetricHistory,
  VisitClinical,
} from "@/types/db"

export interface HistoryExamData {
  patient: Patient
  husband: PatientHusband
  menstrual: PatientMenstrualHistory
  obstetric: PatientObstetricHistory
  medical: PatientMedicalHistory
  surgical: PatientNotesRow
  medications: PatientNotesRow
  family: PatientFamilyHistory
  social: PatientNotesRow
  allergy: PatientAllergy
  /** Visit-level part of the sheet (Date, Present History, visit LMP/EDD). */
  visit?: VisitClinical | null
  visitDate?: string | null
}

export const HISTORY_SECTIONS = ["he-patient", "he-present", "he-menstrual", "he-obstetric", "he-medical", "he-family", "he-allergy"] as const

const BLOOD = ["A", "B", "AB", "O"].map((v) => ({ value: v, label: v }))
const RH = [
  { value: "+", label: "Rh +" },
  { value: "-", label: "Rh −" },
]

/**
 * Digital "History and examination" sheet (paper form v1).
 * Patient-level blanks write to the patient's master history records;
 * Date / Present History / visit LMP write to the visit.
 */
export function HistoryExamForm({
  data,
  canEditPatient,
  canEditMedical,
  canEditVisit = false,
  patientRec,
}: {
  data: HistoryExamData
  canEditPatient: boolean
  canEditMedical: boolean
  canEditVisit?: boolean
  /** Share one controller when the patient row is also edited elsewhere on the page. */
  patientRec?: RecordController<Patient>
}) {
  const t = useTranslations("historyExam")
  const refs = useRefs()
  const ownPatient = useRecord({ table: "patients", keyField: "id", row: data.patient, readOnly: !canEditPatient || !!patientRec, realtime: !patientRec })
  const patient = patientRec ?? ownPatient
  const husband = useRecord({ table: "patient_husbands", keyField: "patient_id", row: data.husband, readOnly: !canEditPatient })
  const mens = useRecord({ table: "patient_menstrual_history", keyField: "patient_id", row: data.menstrual, readOnly: !canEditMedical })
  const obs = useRecord({ table: "patient_obstetric_history", keyField: "patient_id", row: data.obstetric, readOnly: !canEditMedical })
  const med = useRecord({ table: "patient_medical_history", keyField: "patient_id", row: data.medical, readOnly: !canEditMedical })
  const surg = useRecord({ table: "patient_surgical_history", keyField: "patient_id", row: data.surgical, readOnly: !canEditMedical })
  const meds = useRecord({ table: "patient_medications", keyField: "patient_id", row: data.medications, readOnly: !canEditMedical })
  const fam = useRecord({ table: "patient_family_history", keyField: "patient_id", row: data.family, readOnly: !canEditMedical })
  const soc = useRecord({ table: "patient_social_history", keyField: "patient_id", row: data.social, readOnly: !canEditMedical })
  const allergy = useRecord({ table: "patient_allergies", keyField: "patient_id", row: data.allergy, readOnly: !canEditMedical })
  const placeholderVisit = { visit_id: "", version: 0 } as unknown as VisitClinical
  const visit = useRecord({
    table: "visit_clinical",
    keyField: "visit_id",
    row: data.visit ?? placeholderVisit,
    readOnly: !canEditVisit || !data.visit,
    realtime: !!data.visit,
  })

  const all: RecordController<{ version: number } & Record<string, unknown>>[] = [patient, husband, mens, obs, med, surg, meds, fam, soc, allergy] as never
  const lmp = data.visit ? (visit.values.lmp as string | null) : mens.values.lmp
  const lmpInfo = lmpSummary(lmp, mens.values.cycle_frequency)
  const calculatedEdd = eddFromLmp(lmp)
  const ancYes = obs.values.anc === true
  const miscarriages = obs.values.miscarriages ?? 0

  return (
    <div className="space-y-3">
      {all.map((r, i) => (
        <ConflictBanner key={i} rec={r} />
      ))}
      {data.visit && <ConflictBanner rec={visit} />}

      <PaperSheet className="text-[14.5px] leading-relaxed">
        <h2 className="mb-6 text-center text-[22px] font-bold">
          <span className="border-b-2 border-[color:var(--paper-line)] pb-0.5">History and examination</span>
        </h2>

        {/* ---------------- Identification ---------------- */}
        <section id="he-patient" className="grid scroll-mt-48 gap-x-10 sm:grid-cols-[1.35fr_1fr]">
          <div>
            <PaperLine label="Name of Pt. :">
              <MedicalInput rec={patient} field="full_name" label={t("name")} />
            </PaperLine>
            <PaperLine label="Occupation :">
              <MedicalInput rec={patient} field="occupation" label={t("occupation")} />
            </PaperLine>
            <PaperLine label="Husband Name :">
              <MedicalInput rec={husband} field="full_name" label={t("husbandName")} />
            </PaperLine>
            <PaperLine label="Occupation :">
              <MedicalInput rec={husband} field="occupation" label={t("husbandOccupation")} />
            </PaperLine>
            <PaperLine label="Address :">
              <MedicalInput rec={patient} field="address" label={t("address")} maxLength={500} />
            </PaperLine>
          </div>
          <div>
            <PaperLine label="Age:" dash>
              <span className="flex items-baseline gap-2">
                <Calculated label="" value={ageFromDob(patient.values.dob) ?? "—"} title={t("ageFromDob")} />
                <MedicalDateInput rec={patient} field="dob" label={t("dob")} className="text-xs" />
              </span>
            </PaperLine>
            <PaperLine label="Blood group:" dash>
              <span className="flex gap-2">
                <MedicalSelect rec={patient} field="blood_group" options={BLOOD} label={t("bloodGroup")} className="w-16" />
                <MedicalSelect rec={patient} field="rh" options={RH} label={t("rh")} className="w-20" />
              </span>
            </PaperLine>
            <PaperLine label="Age:" dash>
              <span className="flex items-baseline gap-2">
                <Calculated label="" value={ageFromDob(husband.values.dob) ?? "—"} title={t("ageFromDob")} />
                <MedicalDateInput rec={husband} field="dob" label={t("husbandDob")} className="text-xs" />
              </span>
            </PaperLine>
            <PaperLine label="Blood group:" dash>
              <span className="flex gap-2">
                <MedicalSelect rec={husband} field="blood_group" options={BLOOD} label={t("husbandBloodGroup")} className="w-16" />
                <MedicalSelect rec={husband} field="rh" options={RH} label={t("husbandRh")} className="w-20" />
              </span>
            </PaperLine>
            <PaperLine label="Tel No:" dash>
              <span dir="ltr">
                <MedicalInput rec={patient} field="phone" label={t("phone")} />
              </span>
            </PaperLine>
          </div>
        </section>
        <PaperLine label="Marriage date:" className="mt-1 max-w-sm text-[13px]" labelClassName="text-[color:var(--paper-muted)]">
          <MedicalDateInput rec={patient} field="marriage_date" label={t("marriageDate")} />
        </PaperLine>

        <PaperRule />

        {/* ---------------- Date / Present history (visit-level) ---------------- */}
        <section id="he-present" className="scroll-mt-48">
          <p className="mb-2 text-[17px] font-bold">
            Date <span className="ms-3 font-normal">{data.visitDate ? formatDate(data.visitDate) : ""}</span>
          </p>
          <PaperLine label="Present History:" className="items-start">
            {data.visit ? (
              <MedicalTextarea rec={visit} field="present_history" rows={3} label={t("presentHistory")} />
            ) : (
              <p className="pt-0.5 text-[13px] text-[color:var(--paper-muted)] italic">{t("presentHistoryPerVisit")}</p>
            )}
          </PaperLine>
          {data.visit && (
            <PaperLine label="Chief complaint:" className="text-[13px]" labelClassName="text-[color:var(--paper-muted)]">
              <MedicalInput rec={visit} field="chief_complaint" label={t("chiefComplaint")} />
            </PaperLine>
          )}
        </section>

        <PaperRule />

        {/* ---------------- Menstrual history ---------------- */}
        <section id="he-menstrual" className="scroll-mt-48">
          <PaperHeading>Menstrual History</PaperHeading>
          <div className="grid gap-x-10 sm:grid-cols-[1.35fr_1fr]">
            <div>
              <PaperLine label="Menarche:">
                <MedicalNumberInput rec={mens} field="menarche_age" min={6} max={25} label={t("menarche")} className="w-16" />
              </PaperLine>
              <PaperLine label="D/I:" dash>
                <span className="inline-flex items-baseline gap-1">
                  <MedicalNumberInput rec={mens} field="period_duration" min={1} max={20} label={t("periodDuration")} className="w-14" />
                  <span>/</span>
                  <MedicalNumberInput rec={mens} field="cycle_frequency" min={10} max={120} label={t("cycleFrequency")} className="w-14" />
                  <span className="text-[12px] text-[color:var(--paper-muted)]">{t("days")}</span>
                </span>
              </PaperLine>
              <PaperLine label="Amount:" dash>
                <MedicalInput rec={mens} field="amount" label={t("amount")} />
              </PaperLine>
              <PaperLine label="Dysmenorrhea:" dash>
                <MedicalInput rec={mens} field="dysmenorrhea" label={t("dysmenorrhea")} />
              </PaperLine>
            </div>
            <div>
              <PaperLine label="PMS:" dash>
                <MedicalInput rec={mens} field="pms" label={t("pms")} />
              </PaperLine>
              <PaperLine label="LMP:" dash>
                {data.visit ? (
                  <MedicalDateInput rec={visit} field="lmp" label={t("lmp")} imported={!!visit.values.imported_at} />
                ) : (
                  <MedicalDateInput rec={mens} field="lmp" label={t("lmp")} />
                )}
              </PaperLine>
              <PaperLine label="EDD:" dash>
                {data.visit ? (
                  <span className="flex items-baseline gap-2">
                    <MedicalDateInput rec={visit} field="edd" label={t("edd")} />
                    {!visit.values.edd && calculatedEdd && <Calculated label="" value={formatDate(calculatedEdd)} title={t("eddCalculated")} />}
                  </span>
                ) : (
                  <Calculated label="" value={calculatedEdd ? formatDate(calculatedEdd) : "—"} title={t("eddCalculated")} />
                )}
              </PaperLine>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
            <MedicalYesNo rec={mens} field="regular_cycle" label={t("regularCycle")} />
            <Calculated label={t("daysSinceLmp")} value={lmpInfo.daysSinceLmp ?? "—"} />
            <Calculated label={t("expectedNext")} value={lmpInfo.expectedNextCycle ? formatDate(lmpInfo.expectedNextCycle) : "—"} />
          </div>
          <PaperLine label={t("notes")} className="text-[13px]" labelClassName="text-[color:var(--paper-muted)]">
            <MedicalInput rec={mens} field="notes" label={t("menstrualNotes")} />
          </PaperLine>
        </section>

        <PaperRule />

        {/* ---------------- Obstetrical history ---------------- */}
        <section id="he-obstetric" className="scroll-mt-48">
          <PaperHeading>Obstetrical History</PaperHeading>
          <div className="grid gap-x-10 sm:grid-cols-[1.35fr_1fr]">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-10">
                <PaperLine label="Gravida:" dash className="flex-none">
                  <MedicalNumberInput rec={obs} field="gravida" min={0} max={30} label={t("gravida")} className="w-14" />
                </PaperLine>
                <PaperLine label="Para :" className="flex-none">
                  <MedicalNumberInput rec={obs} field="para" min={0} max={30} label={t("para")} className="w-14" />
                </PaperLine>
              </div>
              <PaperLine label="FT" dash>
                <MedicalNumberInput rec={obs} field="full_term" min={0} max={30} label={t("fullTerm")} className="w-14" />
              </PaperLine>
              <div className="my-1 flex flex-wrap gap-x-5 text-[13px]">
                <PaperLine label={t("normal")} labelClassName="text-[color:var(--paper-muted)]">
                  <MedicalNumberInput rec={obs} field="normal_deliveries" min={0} max={30} label={t("normal")} className="w-12" />
                </PaperLine>
                <PaperLine label={t("cSection")} labelClassName="text-[color:var(--paper-muted)]">
                  <MedicalNumberInput rec={obs} field="c_sections" min={0} max={30} label={t("cSection")} className="w-12" />
                </PaperLine>
              </div>
              <PaperLine label="Premature :" dash>
                <MedicalNumberInput rec={obs} field="premature" min={0} max={30} label={t("premature")} className="w-14" />
              </PaperLine>
              <PaperLine label="Abortions :" dash>
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <MedicalNumberInput rec={obs} field="abortions" min={0} max={30} label={t("abortions")} className="w-14" />
                </span>
              </PaperLine>
              <div className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
                <PaperLine label={t("miscarriages")} labelClassName="text-[color:var(--paper-muted)]">
                  <MedicalNumberInput rec={obs} field="miscarriages" min={0} max={30} label={t("miscarriages")} className="w-12" />
                </PaperLine>
                {miscarriages > 0 && (
                  <>
                    <PaperLine label={t("firstTrimester")} labelClassName="text-[color:var(--paper-muted)]">
                      <MedicalNumberInput rec={obs} field="miscarriages_first_trimester" min={0} max={30} label={t("firstTrimester")} className="w-12" />
                    </PaperLine>
                    <PaperLine label={t("secondTrimester")} labelClassName="text-[color:var(--paper-muted)]">
                      <MedicalNumberInput rec={obs} field="miscarriages_second_trimester" min={0} max={30} label={t("secondTrimester")} className="w-12" />
                    </PaperLine>
                  </>
                )}
              </div>
              <PaperLine label="ANC :" dash>
                <MedicalYesNo rec={obs} field="anc" label={t("anc")} hideLabel />
              </PaperLine>
              {ancYes && (
                <div className="ms-6 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  <MedicalYesNo rec={obs} field="anc_dm" label="DM" />
                  <MedicalYesNo rec={obs} field="anc_ht" label="HT" />
                  <MedicalYesNo rec={obs} field="anc_pph" label="PPH" />
                  <MedicalYesNo rec={obs} field="anc_abh" label="ABH" />
                  <div className="basis-full">
                    <MedicalInput rec={obs} field="anc_notes" label={t("ancNotes")} placeholder={t("notes")} />
                  </div>
                </div>
              )}
              <PaperLine label="PPC :" dash>
                <MedicalInput rec={obs} field="ppc" label={t("ppc")} />
              </PaperLine>
            </div>
            <div>
              <PaperLine label="Living(M/F)" dash>
                <span className="inline-flex items-baseline gap-1">
                  <MedicalNumberInput rec={obs} field="living_male" min={0} max={30} label={t("livingMale")} className="w-12" />
                  <span>/</span>
                  <MedicalNumberInput rec={obs} field="living_female" min={0} max={30} label={t("livingFemale")} className="w-12" />
                </span>
              </PaperLine>
              <PaperLine label="Last Delivery" dash>
                <MedicalDateInput rec={obs} field="last_delivery_date" label={t("lastDelivery")} />
              </PaperLine>
              <PaperLine label="Type" dash>
                <MedicalSelect
                  rec={obs}
                  field="last_delivery_type"
                  options={refs.activeOptions("delivery_type", obs.values.last_delivery_type)}
                  label={t("deliveryType")}
                />
              </PaperLine>
              <PaperLine label="DNS" dash>
                <MedicalYesNo rec={obs} field="dns" label="DNS" hideLabel />
              </PaperLine>
            </div>
          </div>
        </section>

        <PaperRule />

        {/* ---------------- Medical / Surgical ---------------- */}
        <section id="he-medical" className="grid scroll-mt-48 gap-x-10 gap-y-4 sm:grid-cols-[1.35fr_1fr]">
          <div>
            <PaperHeading>Medical History</PaperHeading>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <MedicalYesNo rec={med} field="ht" label="HT" />
              <MedicalYesNo rec={med} field="dm" label="DM" />
              <MedicalYesNo rec={med} field="hypothyroidism" label="Hypothyroidism" />
            </div>
            <MedicalTextarea rec={med} field="notes" rows={2} label={t("medicalNotes")} placeholder={t("notes")} className="mt-1" />
            <p className="mt-2 text-[13px] text-[color:var(--paper-muted)]">{t("medications")}</p>
            <MedicalTextarea rec={meds} field="notes" rows={2} label={t("medications")} />
          </div>
          <div>
            <PaperHeading>Surgical History</PaperHeading>
            <MedicalTextarea rec={surg} field="notes" rows={4} label={t("surgicalHistory")} />
          </div>
        </section>

        <PaperRule />

        {/* ---------------- Family / Social ---------------- */}
        <section id="he-family" className="grid scroll-mt-48 gap-x-10 gap-y-4 sm:grid-cols-[1.35fr_1fr]">
          <div>
            <PaperHeading>Family History</PaperHeading>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <MedicalYesNo rec={fam} field="dm" label="DM" />
              <MedicalYesNo rec={fam} field="ht" label="HT" />
              <MedicalYesNo rec={fam} field="thrombosis" label="Thrombosis" />
              <MedicalYesNo rec={fam} field="cancer" label="Cancer" />
            </div>
            <MedicalTextarea rec={fam} field="notes" rows={2} label={t("familyNotes")} placeholder={t("notes")} className="mt-1" />
          </div>
          <div>
            <PaperHeading>Social History</PaperHeading>
            <MedicalTextarea rec={soc} field="notes" rows={3} label={t("socialHistory")} />
          </div>
        </section>

        <section id="he-allergy" className="mt-5 scroll-mt-48">
          <PaperHeading>Drug Allergy</PaperHeading>
          <MedicalTextarea
            rec={allergy}
            field="allergy"
            rows={2}
            label={t("drugAllergy")}
            className="font-bold text-[#c40000] placeholder:font-normal"
            placeholder={t("noKnownAllergy")}
          />
        </section>
      </PaperSheet>
    </div>
  )
}
