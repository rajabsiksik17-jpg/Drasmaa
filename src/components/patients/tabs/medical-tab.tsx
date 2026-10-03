import { getTranslations } from "next-intl/server"
import { ShieldAlert } from "lucide-react"
import { getSession, hasPermission } from "@/lib/auth/session"
import { getHistoryExamData } from "@/lib/data/history"
import { P } from "@/lib/permissions"
import { EmptyState } from "@/components/common/page"
import { HistoryExamWorkspace } from "@/components/medical/history-exam-workspace"

export async function MedicalTab({ patientId }: { patientId: string }) {
  const session = (await getSession())!
  const t = await getTranslations("historyExam")
  const data = await getHistoryExamData(patientId)
  if (!data) return <EmptyState icon={ShieldAlert} title={t("unavailable")} />
  return (
    <HistoryExamWorkspace
      data={data}
      canEditPatient={hasPermission(session, P.patientsEdit)}
      canEditMedical={hasPermission(session, P.medicalEdit)}
      printHref={`/print/history/${patientId}`}
    />
  )
}
