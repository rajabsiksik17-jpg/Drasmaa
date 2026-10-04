import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { getReferenceData } from "@/lib/data/reference"
import { getTodayQueue } from "@/lib/data/encounters"
import { clinicDayRange, clinicToday, formatDate } from "@/lib/dates"
import { PageHeader } from "@/components/common/page"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { QueueBoard } from "@/components/encounters/queue-board"

export const metadata = { title: "Today" }

/** Today's real clinic visits (walk-ins and arrived appointments) as a live queue. */
export default async function TodayPage() {
  await requirePagePermission(P.encountersCreate, P.visitsCreate, P.accountingCreate)
  const t = await getTranslations("encounters")
  const today = clinicToday()
  const [{ rows, error }, refs] = await Promise.all([getTodayQueue(), getReferenceData()])
  if (error) throw new Error("Today's visits could not be loaded.")
  return (
    <div className="space-y-4">
      {/* Only today's clinic visits are watched — not the whole database. */}
      <RealtimeRefresh
        channel={`queue:${today}`}
        specs={[
          { table: "encounters", filter: `queue_date=eq.${today}` },
          { table: "invoices", filter: `issued_at=gte.${clinicDayRange(today).start}` },
        ]}
      />
      <PageHeader title={t("todayTitle")} description={`${t("todayHint")} · ${formatDate(today)}`} />
      <QueueBoard rows={rows} prepay={refs.settings.collect_payment_before_consultation} />
    </div>
  )
}
