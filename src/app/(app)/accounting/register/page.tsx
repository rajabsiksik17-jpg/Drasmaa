import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { clinicToday } from "@/lib/dates"
import { CashRegisterView, type RegisterData } from "@/components/accounting/cash-register"
import type { CashRegister } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounting.nav")
  return { title: t("register") }
}

/** Daily cash register: opening, cash in/out, expenses, expected vs counted, close. */
export default async function RegisterPage({ searchParams }: PageProps<"/accounting/register">) {
  await requirePagePermission(P.accountingView)
  const sp = await searchParams
  const today = clinicToday()
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today
  const supabase = await createClient()
  const [{ data: register }, { data: payments }, { data: expenses }, { data: history }, { data: previous }, { data: settings }, { data: profiles }] = await Promise.all([
    supabase.from("cash_registers").select("*").eq("register_date", date).maybeSingle(),
    supabase.from("payments").select("id, kind, amount, method, receipt_number, received_at, invoice_id").eq("register_date", date).order("received_at"),
    supabase.from("cash_expenses").select("id, amount, description, created_at, created_by").eq("register_date", date).order("created_at"),
    supabase.from("cash_registers").select("*").order("register_date", { ascending: false }).limit(30),
    supabase.from("cash_registers").select("actual_cash").lt("register_date", date).eq("status", "closed").order("register_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("clinic_settings").select("currency").eq("id", 1).single(),
    supabase.from("profiles").select("id, full_name"),
  ])
  const reg = register as CashRegister | null
  const { data: adjustments } = reg
    ? await supabase.from("cash_register_adjustments").select("id, amount, reason, created_at, created_by").eq("register_id", reg.id).order("created_at")
    : { data: [] }
  const data: RegisterData = {
    date,
    today,
    register: reg,
    payments: (payments ?? []) as RegisterData["payments"],
    expenses: (expenses ?? []) as RegisterData["expenses"],
    adjustments: (adjustments ?? []) as RegisterData["adjustments"],
    history: (history ?? []) as CashRegister[],
    suggestedOpening: Number(previous?.actual_cash ?? 0),
    currency: settings?.currency ?? "JOD",
    people: Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name])),
  }
  return <CashRegisterView data={data} />
}
