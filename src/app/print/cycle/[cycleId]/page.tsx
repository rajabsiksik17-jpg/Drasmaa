import { notFound } from "next/navigation"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { getCycleBundle } from "@/lib/data/cycle"
import { P } from "@/lib/permissions"
import { PrintCycle } from "@/components/print/print-views"

export default async function PrintCyclePage({ params }: PageProps<"/print/cycle/[cycleId]">) {
  await requirePagePermission(P.oiView)
  const { cycleId } = await params
  if (!/^[0-9a-f-]{36}$/.test(cycleId)) notFound()
  const supabase = await createClient()
  const { data } = await supabase.from("fertility_cycles").select("patient_id").eq("id", cycleId).maybeSingle()
  if (!data) notFound()
  const bundle = await getCycleBundle(data.patient_id, cycleId)
  return <PrintCycle bundle={bundle} />
}
