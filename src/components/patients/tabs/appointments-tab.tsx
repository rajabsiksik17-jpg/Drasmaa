import { getTranslations } from "next-intl/server"
import { getAppointments } from "@/lib/data/appointments"
import type { PatientContext } from "@/lib/data/patient"
import { AppointmentList } from "@/components/appointments/appointment-list"
import { NewAppointmentButton } from "@/components/appointments/new-appointment-button"

export async function AppointmentsTab({ ctx }: { ctx: PatientContext }) {
  const t = await getTranslations("appointments")
  const now = new Date().toISOString()
  const pid = ctx.patient.id
  const [upcoming, previous] = await Promise.all([
    getAppointments({ patientId: pid, from: now, ascending: true, limit: 50 }),
    getAppointments({ patientId: pid, to: now, ascending: false, limit: 50 }),
  ])
  const picked = { id: pid, full_name: ctx.patient.full_name, patient_code: ctx.patient.patient_code }
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("tabs.upcoming")}</h2>
          <NewAppointmentButton patient={picked} size="sm" />
        </div>
        <AppointmentList rows={upcoming.rows} showDate emptyTitle={t("emptyTab.upcoming")} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("tabs.previous")}</h2>
        <AppointmentList rows={previous.rows} showDate emptyTitle={t("emptyTab.previous")} />
      </section>
    </div>
  )
}
