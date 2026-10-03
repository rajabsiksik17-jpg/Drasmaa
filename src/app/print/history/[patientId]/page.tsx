import { notFound } from "next/navigation"
import { requirePagePermission } from "@/lib/auth/session"
import { getHistoryExamData } from "@/lib/data/history"
import { P } from "@/lib/permissions"
import { PrintHistory } from "@/components/print/print-views"

export default async function PrintHistoryPage({ params }: PageProps<"/print/history/[patientId]">) {
  await requirePagePermission(P.medicalView)
  const { patientId } = await params
  if (!/^[0-9a-f-]{36}$/.test(patientId)) notFound()
  const data = await getHistoryExamData(patientId)
  if (!data) notFound()
  return <PrintHistory data={data} />
}
