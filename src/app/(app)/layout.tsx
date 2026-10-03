import { requireSession } from "@/lib/auth/session"
import { getReferenceData } from "@/lib/data/reference"
import { createClient } from "@/lib/supabase/server"
import { AppProvider, type ClientSession } from "@/components/app-context"
import { AppShell } from "@/components/layout/app-shell"
import type { AppNotification } from "@/types/db"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession()
  const refs = await getReferenceData()
  const supabase = await createClient()
  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", session.userId)
    .is("voided_at", null)
    .order("created_at", { ascending: false })
    .limit(20)

  const clientSession: ClientSession = {
    userId: session.userId,
    email: session.email,
    fullName: session.profile.full_name,
    roleCode: session.role?.code ?? null,
    roleNameEn: session.role?.name_en ?? null,
    roleNameAr: session.role?.name_ar ?? null,
    permissions: session.permissions,
    doctorId: session.doctor?.id ?? null,
    preferences: session.profile.preferences ?? {},
  }

  return (
    <AppProvider session={clientSession} refs={refs}>
      <AppShell initialNotifications={(notifications ?? []) as AppNotification[]}>{children}</AppShell>
    </AppProvider>
  )
}
