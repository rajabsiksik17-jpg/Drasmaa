import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { hasPermission, requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { isEncryptionConfigured } from "@/lib/security/crypto"
import { isServiceRoleConfigured } from "@/lib/security/events"
import { PageHeader } from "@/components/common/page"
import { EmailSettings, type EmailAccountView, type EmailTestRow } from "@/components/admin/email-settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav")
  return { title: t("email") }
}

// Only non-secret columns: ciphertext columns are not even selectable by the user role.
const SAFE_COLUMNS =
  "id, email_address, display_name, smtp_host, smtp_port, smtp_security, smtp_username, imap_enabled, imap_host, imap_port, imap_security, imap_username, smtp_status, imap_status, last_test_at, last_success_email_at, last_failed_email_at, last_error_code, updated_at"

export default async function EmailSettingsPage() {
  const session = await requirePagePermission(P.settingsEmailView, P.settingsEmailManage)
  const t = await getTranslations("emailSettings")
  const supabase = await createClient()
  const { data: account } = await supabase.from("email_accounts").select(SAFE_COLUMNS).eq("is_default", true).maybeSingle()
  const { data: tests } = account
    ? await supabase
        .from("email_connection_tests")
        .select("id, tested_at, smtp_connected, smtp_authenticated, smtp_test_sent, imap_connected, imap_authenticated, error_code, duration_ms, tester:profiles(full_name)")
        .eq("account_id", (account as { id: string }).id)
        .order("tested_at", { ascending: false })
        .limit(20)
    : { data: [] }
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <EmailSettings
        account={(account as EmailAccountView | null) ?? null}
        tests={(tests ?? []) as unknown as EmailTestRow[]}
        canManage={hasPermission(session, P.settingsEmailManage)}
        encryptionReady={isEncryptionConfigured()}
        serviceReady={isServiceRoleConfigured()}
        userEmail={session.email ?? ""}
      />
    </div>
  )
}
