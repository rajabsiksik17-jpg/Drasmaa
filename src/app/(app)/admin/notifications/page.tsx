import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { NotificationSettings, type EventTypeRow, type ReminderRuleRow } from "@/components/admin/notification-settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("notificationSettings") }
}

export default async function NotificationSettingsPage() {
  await requirePagePermission(P.notificationsManage)
  const t = await getTranslations("notificationSettings")
  const supabase = await createClient()
  const [{ data: events }, { data: rules }, { data: account }] = await Promise.all([
    supabase.from("notification_event_types").select("code, category, default_priority, name_en, name_ar, in_app_enabled, email_enabled, is_critical, sort_order").order("sort_order"),
    supabase.from("reminder_rules").select("id, offset_minutes, channel, enabled").order("offset_minutes", { ascending: false }),
    supabase.from("email_accounts").select("smtp_status").eq("is_default", true).maybeSingle(),
  ])
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <NotificationSettings
        events={(events ?? []) as EventTypeRow[]}
        rules={(rules ?? []) as ReminderRuleRow[]}
        emailReady={account?.smtp_status === "ok"}
      />
    </div>
  )
}
