import { notFound } from "next/navigation"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PrintConsent } from "@/components/print/print-views"
import type { IvfConsent } from "@/types/db"

export default async function PrintConsentPage({ params }: PageProps<"/print/consent/[consentId]">) {
  await requirePagePermission(P.fertilityView)
  const { consentId } = await params
  if (!/^[0-9a-f-]{36}$/.test(consentId)) notFound()
  const supabase = await createClient()
  const { data } = await supabase.from("ivf_consents").select("*").eq("id", consentId).maybeSingle()
  if (!data) notFound()
  const consent = data as IvfConsent
  const [{ data: patient }, { data: husband }] = await Promise.all([
    supabase.from("patients").select("full_name").eq("id", consent.patient_id).single(),
    supabase.from("patient_husbands").select("full_name").eq("patient_id", consent.patient_id).maybeSingle(),
  ])
  return <PrintConsent consent={consent} wife={patient?.full_name ?? ""} husband={husband?.full_name ?? ""} />
}
