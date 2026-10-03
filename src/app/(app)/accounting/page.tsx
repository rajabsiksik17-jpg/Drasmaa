import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { resolveRange } from "@/lib/accounting/ranges"
import { AccountingDashboard, type AccountingSummary } from "@/components/accounting/accounting-dashboard"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounting")
  return { title: t("title") }
}

export default async function AccountingPage({ searchParams }: PageProps<"/accounting">) {
  await requirePagePermission(P.accountingView)
  const range = resolveRange(await searchParams)
  const supabase = await createClient()
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase.rpc("accounting_summary", { p_from: range.from, p_to: range.to }),
    supabase.from("clinic_settings").select("currency").eq("id", 1).single(),
  ])
  if (error) console.error(`[accounting] summary failed: ${error.code}`)
  return <AccountingDashboard range={range} summary={(data ?? null) as AccountingSummary | null} currency={settings?.currency ?? "JOD"} />
}
