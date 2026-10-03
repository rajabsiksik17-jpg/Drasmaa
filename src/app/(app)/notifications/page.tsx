import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { PageHeader } from "@/components/common/page"
import { NotificationsPageList } from "@/components/notifications/notifications-page-list"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("notifications") }
}

export default async function NotificationsPage() {
  const t = await getTranslations("notifications")
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <NotificationsPageList />
    </div>
  )
}
