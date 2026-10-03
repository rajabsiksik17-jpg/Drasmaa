import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { NewPatientWizard } from "@/components/patients/new-patient-wizard"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patients")
  return { title: t("new") }
}

export default async function NewPatientPage({ searchParams }: PageProps<"/patients/new">) {
  await requirePagePermission(P.patientsCreate)
  const t = await getTranslations("patients")
  const tn = await getTranslations("nav")
  const sp = await searchParams
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("new")} description={t("newHint")} breadcrumbs={[{ href: "/patients", label: tn("patients") }, { label: t("new") }]} />
      <NewPatientWizard initialName={typeof sp.name === "string" ? sp.name : ""} />
    </div>
  )
}
