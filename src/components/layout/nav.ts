import {
  Bell,
  Calculator,
  Wallet,
  FileSignature,
  Pill,
  Tags,
  FileText,
  Fingerprint,
  Mail,
  MessageCircle,
  MessagesSquare,
  MonitorSmartphone,
  ShieldCheck,
  BellRing,
  Building2,
  CalendarDays,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  Settings,
  ShieldPlus,
  SlidersHorizontal,
  Stethoscope,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react"
import { P, type PermissionCode } from "@/lib/permissions"

export interface NavItem {
  href: string
  labelKey: string
  icon: LucideIcon
  permissions?: PermissionCode[]
  /** Match exactly (no prefix matching). */
  exact?: boolean
  /** Sidebar section heading (admin area). */
  group?: "clinic" | "communication" | "security"
}

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/patients", labelKey: "patients", icon: Users, permissions: [P.patientsView] },
  { href: "/appointments", labelKey: "appointments", icon: CalendarDays, permissions: [P.appointmentsView], exact: true },
  { href: "/reports", labelKey: "reports", icon: FileSignature, permissions: [P.reportsView] },
  { href: "/accounting", labelKey: "accounting", icon: Calculator, permissions: [P.accountingView] },
  { href: "/notifications", labelKey: "notifications", icon: Bell },
  { href: "/settings", labelKey: "settings", icon: Settings },
]

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/clinic", labelKey: "clinic", icon: SlidersHorizontal, permissions: [P.settingsManage], group: "clinic" },
  { href: "/admin/users", labelKey: "users", icon: UserCog, permissions: [P.usersManage], group: "clinic" },
  { href: "/admin/roles", labelKey: "roles", icon: KeyRound, permissions: [P.rolesManage], group: "clinic" },
  { href: "/admin/doctors", labelKey: "doctors", icon: Stethoscope, permissions: [P.settingsManage], group: "clinic" },
  { href: "/admin/departments", labelKey: "departments", icon: Building2, permissions: [P.settingsManage], group: "clinic" },
  { href: "/admin/insurance", labelKey: "insurance", icon: ShieldPlus, permissions: [P.settingsManage], group: "clinic" },
  { href: "/admin/options", labelKey: "options", icon: ListChecks, permissions: [P.settingsManage], group: "clinic" },
  { href: "/admin/pricing", labelKey: "pricing", icon: Tags, permissions: [P.pricingManage], group: "clinic" },
  { href: "/admin/billing", labelKey: "billingSettings", icon: Wallet, permissions: [P.settingsManage], group: "clinic" },
  { href: "/admin/medications", labelKey: "medications", icon: Pill, permissions: [P.medicationsManage], group: "clinic" },
  { href: "/admin/report-templates", labelKey: "reportTemplates", icon: FileSignature, permissions: [P.reportsEdit], group: "communication" },
  { href: "/admin/email", labelKey: "email", icon: Mail, permissions: [P.settingsEmailView, P.settingsEmailManage], group: "communication" },
  { href: "/admin/notifications", labelKey: "notificationSettings", icon: BellRing, permissions: [P.notificationsManage], group: "communication" },
  { href: "/admin/templates", labelKey: "templates", icon: MessagesSquare, permissions: [P.templatesView], group: "communication" },
  { href: "/admin/whatsapp", labelKey: "whatsapp", icon: MessageCircle, permissions: [P.settingsManage], group: "communication" },
  { href: "/admin/documents", labelKey: "documentTemplates", icon: FileText, permissions: [P.templatesEdit], group: "communication" },
  { href: "/admin/security", labelKey: "securityCenter", icon: ShieldCheck, permissions: [P.securityView], group: "security" },
  { href: "/admin/authentication", labelKey: "authentication", icon: Fingerprint, permissions: [P.securityManage], group: "security" },
  { href: "/admin/sessions", labelKey: "sessions", icon: MonitorSmartphone, permissions: [P.sessionsView], group: "security" },
  { href: "/admin/audit", labelKey: "audit", icon: ScrollText, permissions: [P.auditView], group: "security" },
]
