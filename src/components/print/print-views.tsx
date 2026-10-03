"use client"

import { useTranslations } from "next-intl"
import { HistoryExamForm, type HistoryExamData } from "@/components/medical/history-exam-form"
import { FertilityForm } from "@/components/visits/fertility-form"
import { GynecologyForm } from "@/components/visits/gynecology-form"
import { PregnancyCard, type PregnancyCardPatient } from "@/components/pregnancy/pregnancy-card"
import { VisitResultsProvider } from "@/components/visits/visit-results"
import { OiChart } from "@/components/oi/oi-chart"
import { PrintHeader } from "@/components/print/print-toolbar"
import { useRecord } from "@/hooks/use-record"
import { ageFromDob, formatDate, formatDateTime } from "@/lib/dates"
import type { VisitBundle } from "@/lib/data/visit"
import type { CycleBundle } from "@/lib/data/cycle"
import type { Patient, PregnancyCase, PregnancyFollowup } from "@/types/db"

/* Read-only renderings of the paper forms, fed with fresh server data. */

export function PrintHistory({ data }: { data: Omit<HistoryExamData, "visit" | "visitDate"> }) {
  return (
    <div className="mx-auto max-w-[210mm]">
      <HistoryExamForm data={data} canEditPatient={false} canEditMedical={false} />
    </div>
  )
}

export function PrintVisit({ bundle, history }: { bundle: VisitBundle; history: Omit<HistoryExamData, "visit" | "visitDate"> }) {
  const t = useTranslations("visits")
  const v = bundle.visit
  const patientRec = useRecord({ table: "patients", keyField: "id", row: history.patient as Patient, readOnly: true, realtime: false })
  return (
    <div className="mx-auto max-w-[210mm] space-y-4">
      <div className="paper px-6 py-3 print:px-0">
        <PrintHeader
          title={`${t(`type.${v.visit_type}`)} — ${formatDate(v.visit_date)}`}
          subtitle={`${history.patient.full_name} · ${history.patient.patient_code} · ${t("formVersion", { code: v.form_code, version: v.form_version })}${v.completed_at ? ` · ${t("completedOn", { date: formatDateTime(v.completed_at) })}` : ""}`}
        />
      </div>
      <HistoryExamForm data={{ ...history, visit: bundle.clinical, visitDate: v.visit_date }} canEditPatient={false} canEditMedical={false} />
      <div className="print-break-before" />
      <VisitResultsProvider patientId={history.patient.id} visitId={v.id} initial={bundle.results} previous={[]} readOnly>
        {bundle.fertility?.visit && (
          <FertilityForm
            patientRec={patientRec}
            data={bundle.fertility}
            patientId={history.patient.id}
            visitId={v.id}
            canEdit={false}
            canOi={false}
            canUpload={false}
          />
        )}
        {bundle.gynecology?.gvisit && <GynecologyForm data={bundle.gynecology} patientId={history.patient.id} visitId={v.id} canEdit={false} />}
        {bundle.pregnancy?.pcase && (
          <PregnancyCard
            pcase={bundle.pregnancy.pcase}
            followups={bundle.pregnancy.followups}
            patient={{
              full_name: history.patient.full_name,
              age: ageFromDob(history.patient.dob),
              patient_code: history.patient.patient_code,
              wifeBlood: [history.patient.blood_group, history.patient.rh].filter(Boolean).join(" "),
              husbandBlood: [history.husband?.blood_group, history.husband?.rh].filter(Boolean).join(" "),
            }}
            editableRowIds={[]}
            canEditCase={false}
            canCorrect={false}
          />
        )}
      </VisitResultsProvider>
    </div>
  )
}

export function PrintCycle({ bundle }: { bundle: CycleBundle }) {
  return (
    <div className="print-landscape mx-auto max-w-[297mm]">
      <OiChart bundle={bundle} canEdit={false} />
    </div>
  )
}

export function PrintPregnancy({ pcase, followups, patient }: { pcase: PregnancyCase; followups: PregnancyFollowup[]; patient: PregnancyCardPatient }) {
  return (
    <div className="print-landscape mx-auto max-w-[297mm]">
      <PregnancyCard pcase={pcase} followups={followups} patient={patient} editableRowIds={[]} canEditCase={false} canCorrect={false} />
    </div>
  )
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className="inline-grid size-[14px] shrink-0 translate-y-[2px] place-items-center border border-black text-[11px] leading-none font-bold">
      {checked ? "✓" : ""}
    </span>
  )
}

/** IVF couple-consent form (paper form v1), filled with the recorded selections. */
export function PrintConsent({
  consent,
  wife,
  husband,
}: {
  consent: { technique: string | null; surplus_embryos: string | null; genetic_testing: boolean; consent_date: string | null }
  wife: string
  husband: string
}) {
  return (
    <div className="paper mx-auto max-w-[210mm] px-10 py-8 text-[15px] leading-loose" dir="rtl" lang="ar">
      <PrintHeader />
      <p>التاريخ: {consent.consent_date ? formatDate(consent.consent_date) : "    /    /    "}</p>
      <h1 className="my-3 text-center text-[17px] font-bold">نموذج موافقة الزوجين على إجراء برنامج الإخصاب خارج الجسم</h1>
      <p className="mb-2 text-[13px]">
        الزوجة: <b>{wife}</b> &nbsp;&nbsp;&nbsp; الزوج: <b>{husband || "................"}</b>
      </p>
      <ul className="list-none space-y-1">
        <li>○ نوافق نحن الزوجين على إجراء برنامج الإخصاب خارج الجسم بإحدى التقنيتين:</li>
        <li className="ms-8 flex gap-2"><Box checked={consent.technique === "classic"} /> التقنية الكلاسيكية.</li>
        <li className="ms-8 flex gap-2"><Box checked={consent.technique === "icsi"} /> تقنية الإخصاب المجهري للبويضات.</li>
        <li className="mt-2">○ حيث قدم لنا الفريق شرحاً وافياً لتفاصيل البرنامج وإجابات واضحة لتساؤلاتنا.</li>
        <li className="ms-6">- نوافق على إجراء كل ما طلب من فحوصات طبية والالتزام بمراحل العلاجات المقررة للبرنامج.</li>
        <li className="ms-6">- نوافق على إجراء عملية سحب البويضات تحت التخدير العام.</li>
        <li className="ms-6">- نوافق على إجراء خطوة إعادة الأجنة للرحم.</li>
        <li className="ms-6">- نوافق على الالتزام بالتكاليف المالية في مواعيدها.</li>
        <li className="mt-2">○ بعد توضيح تفاصيل البرنامج نحن على علم بما يلي:</li>
        <li className="ms-6">- قد تكون نتائج تحريض الإباضة غير مرضية (إذا كان تجاوب المبيض معدوماً، محدوداً أو مفرطاً) مما يستدعي توقف البرنامج.</li>
        <li className="ms-6">- هناك احتمالية ضئيلة لحصول الإباضة المفرطة (تضخم في كلا المبيضين) ومضاعفاتها أثناء مراحل البرنامج، حيث يقوم أعضاء الفريق باتخاذ الإجراءات الطبية اللازمة لسلامة الزوجة.</li>
        <li className="ms-6">- لا ضمان بالتقاط جميع البويضات المتوقعة من جريباتها، وقليلاً ما تنتهي هذه الخطوة بعدم الحصول على أي منها.</li>
        <li className="ms-6">- في حال عدم قدرة الزوج على قذف عينة السائل المنوي قد يلزم التدخل جراحياً لاستخلاص الحيوانات المنوية من الخصية أو البربخ.</li>
        <li className="ms-6">- لا ضمان بحصول التلقيح لجميع البويضات أو الانقسام لجميع البويضات الملقحة.</li>
        <li className="ms-6">- لا ضمان بحصول الحمل بعد إعادة الأجنة للرحم أو استمرار الحمل حين حصوله لمرحلة الولادة.</li>
        <li className="mt-2">○ في حالة توفر فائض من الأجنة جيدة النوعية عن العدد المنقول للرحم.</li>
        <li className="ms-8 flex gap-2"><Box checked={consent.surplus_embryos === "freeze"} /> <span>نرغب في الاحتفاظ بها في نظام التجميد على أمل الاستفادة منها مستقبلاً وذلك لمدة لا تتجاوز خمس سنوات قابلة للتجديد لمدة مماثلة بطلب منا نحن الزوجين.</span></li>
        <li className="ms-8 flex gap-2"><Box checked={consent.surplus_embryos === "discard"} /> نطلب التخلص من جميع الأجنة المتبقية.</li>
        <li className="ms-8 text-[13px]">( يرفق مع هذا البند توقيع نموذج موافقة خاص بتجميد الأجنة ).</li>
        <li className="mt-2 flex gap-2"><Box checked={consent.genetic_testing} /> <span>نرغب بإجراء الفحص الوراثي للأجنة قبل إعادتها للرحم بهدف دراسة الكروموسومات الممكنة لتحديد سلامة الجنين. ( يرفق مع هذا البند توقيع نموذج موافقة خاص بالفحص الوراثي للأجنة ).</span></li>
      </ul>
      <div className="mt-12 grid grid-cols-3 gap-8 text-center">
        {["الزوجة", "الزوج", "فريق الإخصاب"].map((label) => (
          <div key={label}>
            <p className="font-semibold">{label}</p>
            <p className="mt-8 border-b border-dotted border-black" />
          </div>
        ))}
      </div>
    </div>
  )
}
