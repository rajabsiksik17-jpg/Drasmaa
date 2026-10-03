import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { requireSession } from "@/lib/auth/session"
import { PageHeader } from "@/components/common/page"
import { PreferencesForm } from "@/components/settings/preferences-form"
import { MyNotificationPreferences, type MyEventPref } from "@/components/settings/my-notification-preferences"
import { createClient } from "@/lib/supabase/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("settings") }
}

export default async function SettingsPage() {
  const session = await requireSession()
  const t = await getTranslations("settings")
  const supabase = await createClient()
  const [{ data: events }, { data: prefs }] = await Promise.all([
    supabase.from("notification_event_types").select("code, category, name_en, name_ar, in_app_enabled, email_enabled, is_critical, sort_order").order("sort_order"),
    supabase.from("user_notification_preferences").select("event_code, in_app, email").eq("user_id", session.userId),
  ])
  const prefMap = new Map((prefs ?? []).map((p) => [p.event_code as string, p]))
  const rows: MyEventPref[] = (events ?? [])
    .filter((e) => e.in_app_enabled || e.email_enabled)
    .map((e) => ({
      code: e.code,
      category: e.category,
      name_en: e.name_en,
      name_ar: e.name_ar,
      is_critical: e.is_critical,
      emailAvailable: e.email_enabled,
      in_app: prefMap.get(e.code)?.in_app ?? true,
      email: prefMap.get(e.code)?.email ?? true,
    }))
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <PreferencesForm preferences={session.profile.preferences ?? {}} email={session.email}>
        <MyNotificationPreferences rows={rows} />
      </PreferencesForm>
    </div>
  )
}
