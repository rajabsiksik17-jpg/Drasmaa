import { requirePagePermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePagePermission(
    P.settingsManage,
    P.usersManage,
    P.rolesManage,
    P.auditView,
    P.settingsEmailView,
    P.settingsEmailManage,
    P.notificationsManage,
    P.templatesView,
    P.templatesEdit,
    P.securityView,
    P.securityManage,
    P.sessionsView,
    P.pricingView,
    P.pricingManage,
    P.medicationsManage,
    P.reportsEdit,
  )
  return <div className="space-y-4">{children}</div>
}
