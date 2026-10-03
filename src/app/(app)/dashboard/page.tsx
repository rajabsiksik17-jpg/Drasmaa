import type { Metadata } from "next"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import {
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  HeartPulse,
  Hourglass,
  Stethoscope,
  UserPlus,
  Users,
} from "lucide-react"
import { requireSession, hasPermission } from "@/lib/auth/session"
import { dayWindow, getAppointmentCounts, getAppointments } from "@/lib/data/appointments"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { clinicToday, formatDate, formatDateLong, formatTime, isoToClinicParts } from "@/lib/dates"
import { PageHeader, SectionCard, StatCard, EmptyState } from "@/components/common/page"
import { AppointmentList } from "@/components/appointments/appointment-list"
import { NewAppointmentButton } from "@/components/appointments/new-appointment-button"
import { DoctorQueue } from "@/components/dashboard/doctor-queue"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@/components/ui/button"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("dashboard") }
}

export default async function DashboardPage() {
  const session = await requireSession()
  const t = await getTranslations("dashboard")
  const locale = await getLocale()
  const can = (code: (typeof P)[keyof typeof P]) => hasPermission(session, code)

  const isDoctor = !!session.doctor && can(P.visitsCreate)
  const isFrontDesk = can(P.appointmentsCheckin)
  const canSeeAppointments = can(P.appointmentsView)
  // Doctors see their own day unless they also run the front desk.
  const doctorScope = isDoctor && !isFrontDesk ? session.doctor!.id : null

  const today = dayWindow(0)
  const [counts, todayList, upcoming] = canSeeAppointments
    ? await Promise.all([
        getAppointmentCounts(doctorScope),
        getAppointments({ from: today.start, to: today.end, doctorId: doctorScope, limit: 200 }),
        isDoctor
          ? getAppointments({
              from: today.end,
              doctorId: session.doctor!.id,
              statuses: ["scheduled"],
              limit: 6,
            })
          : Promise.resolve({ rows: [], total: 0 }),
      ])
    : [null, { rows: [], total: 0 }, { rows: [], total: 0 }]

  let activeCycles: { id: string; cycle_number: number; patient_id: string; started_at: string; patient: { full_name: string; patient_code: string } | null }[] = []
  if (isDoctor && can(P.oiView)) {
    const supabase = await createClient()
    const { data } = await supabase
      .from("fertility_cycles")
      .select("id, cycle_number, patient_id, started_at, patient:patients(full_name, patient_code)")
      .eq("status", "active")
      .eq("doctor_id", session.doctor!.id)
      .order("started_at", { ascending: false })
      .limit(6)
    activeCycles = (data ?? []) as unknown as typeof activeCycles
  }

  const queue = todayList.rows
    .filter((a) => a.status === "checked_in")
    .sort((a, b) => (a.checked_in_at ?? "").localeCompare(b.checked_in_at ?? ""))
  const current = todayList.rows.filter((a) => a.status === "with_doctor")
  const firstName = session.profile.full_name.split(" ")[0]

  return (
    <div className="space-y-6">
      {canSeeAppointments && (
        <RealtimeRefresh
          channel="dashboard"
          specs={[{ table: "appointments", filter: doctorScope ? `doctor_id=eq.${doctorScope}` : undefined }]}
        />
      )}
      <PageHeader
        title={t("greeting", { name: firstName })}
        description={formatDateLong(clinicToday(), locale)}
        actions={
          <>
            {can(P.patientsCreate) && (
              <Button variant="outline" asChild>
                <Link href="/patients/new">
                  <UserPlus />
                  {t("newPatient")}
                </Link>
              </Button>
            )}
            <NewAppointmentButton />
          </>
        }
      />

      {counts && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label={t("today")} value={counts.today_total} icon={CalendarDays} href="/appointments?tab=today" />
          <StatCard label={t("waiting")} value={counts.waiting} icon={Hourglass} tone="waiting" />
          <StatCard label={t("withDoctor")} value={counts.with_doctor} icon={Stethoscope} tone="doctor" />
          <StatCard label={t("completed")} value={counts.completed} icon={CheckCircle2} tone="done" />
          <StatCard label={t("tomorrow")} value={counts.tomorrow} icon={CalendarClock} tone="muted" href="/appointments?tab=tomorrow" />
        </div>
      )}

      {isDoctor ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <DoctorQueue waiting={queue} current={current} />
            <SectionCard title={t("todaySchedule")} icon={CalendarCheck2} bodyClassName="p-0 md:p-0">
              <div className="p-3">
                <AppointmentList rows={todayList.rows} hideDoctor={!!doctorScope} emptyTitle={t("noToday")} />
              </div>
            </SectionCard>
          </div>
          <div className="space-y-6">
            <SectionCard title={t("activeCycles")} icon={HeartPulse}>
              {activeCycles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noActiveCycles")}</p>
              ) : (
                <ul className="divide-y">
                  {activeCycles.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/patients/${c.patient_id}/cycles/${c.id}`}
                        className="flex items-center justify-between gap-2 py-2 text-sm hover:text-primary"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.patient?.full_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {t("cycleNumber", { number: c.cycle_number })} · {formatDate(isoToClinicParts(c.started_at).date)}
                          </span>
                        </span>
                        <HeartPulse className="size-4 text-primary" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard title={t("upcoming")} icon={Clock}>
              {upcoming.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noUpcoming")}</p>
              ) : (
                <ul className="divide-y">
                  {upcoming.rows.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/patients/${a.patient_id}`} className="min-w-0 hover:text-primary">
                        <span className="block truncate font-medium">{a.patient?.full_name}</span>
                        <span className="text-xs text-muted-foreground">{formatDateLong(isoToClinicParts(a.scheduled_at).date, locale)}</span>
                      </Link>
                      <span className="text-xs font-medium tabular-nums">{formatTime(a.scheduled_at, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      ) : canSeeAppointments ? (
        <div className="space-y-6">
        {session.profile.preferences?.dashboard === "queue_first" && (
          <SectionCard title={t("queue")} icon={Hourglass} bodyClassName="p-3">
            <AppointmentList rows={queue} emptyTitle={t("queueEmpty")} />
          </SectionCard>
        )}
        <SectionCard
          title={t("todayBoard")}
          icon={CalendarCheck2}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/appointments?tab=tomorrow">{t("viewTomorrow")}</Link>
            </Button>
          }
          bodyClassName="p-3"
        >
          <AppointmentList rows={todayList.rows} emptyTitle={t("noToday")} emptyAction={<NewAppointmentButton size="sm" />} />
        </SectionCard>
        </div>
      ) : (
        <EmptyState icon={Users} title={t("welcomeNoAccess")} description={t("welcomeNoAccessBody")} />
      )}
    </div>
  )
}
