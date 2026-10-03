import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { startOfWeek, parseISO, format } from "date-fns"
import { requirePagePermission, hasPermission } from "@/lib/auth/session"
import { dayWindow, getAppointments } from "@/lib/data/appointments"
import { P } from "@/lib/permissions"
import { addDaysIso, clinicDayRange, clinicToday, formatDateLong } from "@/lib/dates"
import { PageHeader } from "@/components/common/page"
import { AppointmentList } from "@/components/appointments/appointment-list"
import { AppointmentFilters, AppointmentTabs, Pager } from "@/components/appointments/appointment-filters"
import { NewAppointmentButton } from "@/components/appointments/new-appointment-button"
import { WeekCalendar } from "@/components/appointments/week-calendar"
import { RealtimeRefresh } from "@/components/realtime-refresh"
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
  } else {
    const query =
      tab === "today"
        ? { ...dayWindow(0), ascending: true }
        : tab === "tomorrow"
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
        <AppointmentList rows={rows} showDate={tab !== "today" && tab !== "tomorrow"} emptyTitle={emptyTitle} />
        <Pager page={page} pageSize={PAGE_SIZE} total={total} />
      </>
    )
  }

  return (
    <div className="space-y-4">
      <RealtimeRefresh channel="appointments-page" specs={[{ table: "appointments" }]} />
      <PageHeader title={t("title")} description={t("subtitle")} actions={<NewAppointmentButton />} />
      <AppointmentTabs current={tab} />
      <AppointmentFilters />
      {content}
    </div>
  )
}
