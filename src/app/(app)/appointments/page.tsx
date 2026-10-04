import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { startOfWeek, parseISO, format } from "date-fns"
import { requirePagePermission, hasPermission } from "@/lib/auth/session"
import { dayWindow, getAppointments } from "@/lib/data/appointments"
import { P } from "@/lib/permissions"
import { addDaysIso, clinicDayRange, clinicToday, formatDateLong } from "@/lib/dates"
import { PageHeader } from "@/components/common/page"
import { AppointmentList } from "@/components/appointments/appointment-list"
import { AppointmentFilters, AppointmentTabs, DAY_VIEWS, DayViewChips, Pager, type DayView } from "@/components/appointments/appointment-filters"
import { EncounterCards, QueueBoard } from "@/components/encounters/queue-board"
import { SectionCard } from "@/components/common/page"
import { getTodayQueue, type QueueEncounter } from "@/lib/data/encounters"
import { getReferenceData } from "@/lib/data/reference"
import { CalendarClock, DoorOpen, CheckCircle2 } from "lucide-react"
import { NewAppointmentButton } from "@/components/appointments/new-appointment-button"
import { WeekCalendar } from "@/components/appointments/week-calendar"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { isNavigationError } from "@/lib/navigation-error"
import type { AppointmentStatus } from "@/types/db"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("appointments") }
}

const TABS = ["today", "tomorrow", "upcoming", "previous", "calendar"] as const
type Tab = (typeof TABS)[number]
const PAGE_SIZE = 25

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : null)
const uuidOrNull = (v: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null)

export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  const session = await requirePagePermission(P.appointmentsView)
  const t = await getTranslations("appointments")
  const sp = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(str(sp.tab) ?? "") ? (str(sp.tab) as Tab) : "today"
  const doctorId = uuidOrNull(str(sp.doctor))
  const departmentId = uuidOrNull(str(sp.dept))
  const visitType = str(sp.type)
  const status = str(sp.status) as AppointmentStatus | null
  const page = Math.max(0, Number(str(sp.page) ?? 0) || 0)
  const filters = { doctorId, departmentId, visitType, statuses: status ? [status] : undefined }
  const today = clinicToday()
  const nowIso = new Date().toISOString()
  const restrictedHistory = !hasPermission(session, P.appointmentsViewHistory)

  let content: React.ReactNode
  let total = 0
  if (tab === "calendar") {
    const anchor = str(sp.week) && /^\d{4}-\d{2}-\d{2}$/.test(str(sp.week)!) ? str(sp.week)! : today
    const weekStart = format(startOfWeek(parseISO(anchor), { weekStartsOn: 6 }), "yyyy-MM-dd") // Saturday-first week
    const from = clinicDayRange(weekStart).start
    const to = clinicDayRange(addDaysIso(weekStart, 7)).start
    const { rows } = await getAppointments({ ...filters, from, to, limit: 1000 })
    content = <WeekCalendar weekStart={weekStart} rows={rows.filter((r) => r.status !== "rescheduled")} />
  } else if (tab === "today") {
    // One failing part must not take the whole Appointments page down.
    try {
      content = await clinicDay({ sp, filters, emptyAppointments: t("emptyTab.today"), session })
    } catch (error) {
      if (isNavigationError(error)) throw error
      console.error("[appointments] today view failed", error)
      const { rows } = await getAppointments({ ...filters, from: dayWindow(0).start, to: dayWindow(0).end, ascending: true, limit: 300 })
      content = (
        <div className="space-y-3">
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t("clinicViewFailed")}
          </p>
          <AppointmentList rows={rows} emptyTitle={t("emptyTab.today")} />
        </div>
      )
    }
  } else {
    const query =
      tab === "tomorrow"
          ? { ...dayWindow(1), ascending: true }
          : tab === "upcoming"
            ? { start: nowIso, end: undefined, ascending: true }
            : { start: undefined, end: nowIso, ascending: false }
    const { rows, total: count } = await getAppointments({
      ...filters,
      statuses: filters.statuses ?? (tab === "upcoming" ? ["scheduled", "checked_in"] : undefined),
      from: query.start,
      to: query.end,
      ascending: query.ascending,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
    total = count
    const emptyTitle = t(`emptyTab.${tab}`)
    content = (
      <>
        {tab === "tomorrow" && (
          <p className="mb-3 text-sm text-muted-foreground">{t("tomorrowHeading", { date: formatDateLong(addDaysIso(today, 1)) })}</p>
        )}
        {tab === "previous" && restrictedHistory && (
          <p className="mb-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t("historyRestricted")}</p>
        )}
        <AppointmentList rows={rows} showDate={tab !== "tomorrow"} emptyTitle={emptyTitle} />
        <Pager page={page} pageSize={PAGE_SIZE} total={total} />
      </>
    )
  }

  return (
    <div className="space-y-4">
      <RealtimeRefresh
        channel="appointments-page"
        specs={[{ table: "appointments" }, { table: "encounters", filter: `queue_date=eq.${today}` }]}
      />
      <PageHeader title={t("title")} description={t("subtitle")} actions={<NewAppointmentButton />} />
      <AppointmentTabs current={tab} />
      <AppointmentFilters />
      {content}
    </div>
  )
}

const ARRIVED = ["waiting_payment", "waiting_doctor", "called", "with_doctor", "awaiting_checkout"] as const
const VIEW_FILTER: Record<Exclude<DayView, "all" | "appointments" | "visits">, readonly string[]> = {
  waiting: ["waiting_payment", "waiting_doctor", "called"],
  with_doctor: ["with_doctor"],
  completed: ["awaiting_checkout", "checked_out"],
}

/**
 * The clinic day in one place: planned appointments and actual clinic visits
 * (walk-ins and arrived appointments), with filters instead of extra pages.
 */
async function clinicDay({
  sp,
  filters,
  emptyAppointments,
  session,
}: {
  sp: Record<string, string | string[] | undefined>
  filters: { doctorId: string | null; departmentId: string | null; visitType: string | null; statuses?: AppointmentStatus[] }
  emptyAppointments: string
  session: Awaited<ReturnType<typeof requirePagePermission>>
}) {
  const t = await getTranslations("appointments")
  const view: DayView = (DAY_VIEWS as readonly string[]).includes(str(sp.view) ?? "") ? (str(sp.view) as DayView) : "all"
  const canQueue = hasPermission(session, P.encountersCreate) || hasPermission(session, P.visitsCreate) || hasPermission(session, P.accountingView)
  const today = dayWindow(0)
  const [{ rows: appts }, queue, refs] = await Promise.all([
    getAppointments({ ...filters, from: today.start, to: today.end, ascending: true, limit: 300 }),
    canQueue ? getTodayQueue() : Promise.resolve({ rows: [] as QueueEncounter[], error: false }),
    getReferenceData(),
  ])
  const visits = queue.rows.filter((e) => !filters.doctorId || e.doctor_id === filters.doctorId)
  const arrivedAppointments = new Set(visits.map((e) => e.appointment_id).filter(Boolean))
  const notArrived = appts.filter((a) => !arrivedAppointments.has(a.id) && a.status !== "rescheduled")
  const inClinic = visits.filter((e) => (ARRIVED as readonly string[]).includes(e.status))
  const by = (statuses: readonly string[]) => visits.filter((e) => statuses.includes(e.status))
  const counts: Record<DayView, number> = {
    all: notArrived.length + visits.filter((e) => e.status !== "cancelled").length,
    appointments: appts.filter((a) => a.status !== "rescheduled").length,
    visits: visits.filter((e) => e.status !== "cancelled").length,
    waiting: by(VIEW_FILTER.waiting).length,
    with_doctor: by(VIEW_FILTER.with_doctor).length,
    completed: by(VIEW_FILTER.completed).length,
  }

  let body: React.ReactNode
  if (view === "appointments") {
    body = <AppointmentList rows={appts.filter((a) => a.status !== "rescheduled")} emptyTitle={emptyAppointments} />
  } else if (view === "visits") {
    body = <QueueBoard rows={visits} prepay={refs.settings.collect_payment_before_consultation} />
  } else if (view !== "all") {
    body = <EncounterCards rows={by(VIEW_FILTER[view])} empty={t(`viewEmpty.${view}`)} />
  } else {
    body = (
      <div className="space-y-4">
        {canQueue && (
          <SectionCard title={t("inClinicNow")} icon={DoorOpen} bodyClassName="p-3">
            <EncounterCards rows={inClinic} empty={t("viewEmpty.inClinic")} />
          </SectionCard>
        )}
        <SectionCard title={t("upcomingToday")} icon={CalendarClock} bodyClassName="p-3">
          <AppointmentList rows={notArrived} emptyTitle={emptyAppointments} />
        </SectionCard>
        {canQueue && by(["checked_out"]).length > 0 && (
          <SectionCard title={t("finishedToday")} icon={CheckCircle2} bodyClassName="p-3">
            <EncounterCards rows={by(["checked_out"])} empty="" />
          </SectionCard>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <DayViewChips current={view} counts={counts} />
      {body}
    </div>
  )
}
