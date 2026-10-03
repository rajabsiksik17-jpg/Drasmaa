import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission, hasPermission } from "@/lib/auth/session"
import { getPatientContext } from "@/lib/data/patient"
import { getCycleBundle } from "@/lib/data/cycle"
import { P } from "@/lib/permissions"
import { Breadcrumbs } from "@/components/common/page"
import { OiWorkspace } from "@/components/oi/oi-workspace"

export async function generateMetadata({ params }: PageProps<"/patients/[patientId]/cycles/[cycleId]">): Promise<Metadata> {
  const t = await getTranslations("oi")
  const { patientId, cycleId } = await params
  const b = await getCycleBundle(patientId, cycleId)
  return { title: t("title", { number: b.cycle.cycle_number }) }
}

export default async function CyclePage({ params }: PageProps<"/patients/[patientId]/cycles/[cycleId]">) {
  const session = await requirePagePermission(P.oiView)
  const { patientId, cycleId } = await params
  const t = await getTranslations("oi")
  const tn = await getTranslations("nav")
  const [ctx, bundle] = await Promise.all([getPatientContext(patientId), getCycleBundle(patientId, cycleId)])
  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { href: "/patients", label: tn("patients") },
          { href: `/patients/${patientId}`, label: ctx.patient.full_name },
          { href: `/patients/${patientId}?tab=fertility`, label: t("fertility", { number: bundle.fcase?.case_number ?? "" }) },
          { label: t("title", { number: bundle.cycle.cycle_number }) },
        ]}
      />
      <OiWorkspace
        patientId={patientId}
        bundle={bundle}
        canEdit={hasPermission(session, P.oiEdit)}
        canCorrect={hasPermission(session, P.oiEdit)}
      />
    </div>
  )
}
