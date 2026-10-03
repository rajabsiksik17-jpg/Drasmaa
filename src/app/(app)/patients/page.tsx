import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { UserPlus } from "lucide-react"
import { requirePagePermission, hasPermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { PatientsTable, PatientSearchBox } from "@/components/patients/patients-table"
import { Pager } from "@/components/appointments/appointment-filters"
import { Button } from "@/components/ui/button"
import type { Patient } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("patients") }
}

const PAGE_SIZE = 25

export default async function PatientsPage({ searchParams }: PageProps<"/patients">) {
  const session = await requirePagePermission(P.patientsView)
  const t = await getTranslations("patients")
  const sp = await searchParams
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : ""
  const page = Math.max(0, Number(sp.page ?? 0) || 0)
  const supabase = await createClient()

  // Server-side search + pagination: the browser never receives the full list.
  const { data } = await supabase.rpc("search_patients", { p_query: q, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE })
  const rows = (data ?? []) as (Pick<Patient, "id" | "patient_code" | "full_name" | "dob" | "phone" | "status"> & { total: number })[]
  const total = rows[0]?.total ?? 0
  const ids = rows.map((r) => r.id)
  const { data: versions } = ids.length
    ? await supabase.from("patients").select("id, version").in("id", ids)
    : { data: [] as { id: string; version: number }[] }
  const versionOf = Object.fromEntries((versions ?? []).map((v) => [v.id, v.version]))

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle", { count: total })}
        actions={
          hasPermission(session, P.patientsCreate) && (
            <Button asChild>
              <Link href="/patients/new">
                <UserPlus />
                {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <PatientSearchBox initial={q} />
      <PatientsTable rows={rows.map((r) => ({ ...r, version: versionOf[r.id] ?? 1 }))} query={q} />
      <Pager page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  )
}
