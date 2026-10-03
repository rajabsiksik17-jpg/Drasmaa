"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { motion } from "motion/react"
import { CalendarDays, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Search, Users } from "lucide-react"
import { useCan, useRefs, useSession } from "@/components/app-context"
import { CommandPalette, useCommandPalette } from "@/components/layout/command-palette"
import { Topbar } from "@/components/layout/topbar"
import { NotificationsProvider } from "@/components/notifications/notifications-provider"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ADMIN_NAV, MAIN_NAV, type NavItem } from "@/components/layout/nav"
import { cn } from "@/lib/utils"
import { useLocalPreference } from "@/hooks/use-local-preference"
import type { AppNotification } from "@/types/db"

// Tablets default to the compact rail.
const defaultCollapsed = () => window.innerWidth < 1280

export function AppShell({ children, initialNotifications }: { children: React.ReactNode; initialNotifications: AppNotification[] }) {
  const [collapsed, setCollapsed] = useLocalPreference("ui.sidebar.collapsed", defaultCollapsed)
  const palette = useCommandPalette()
  const pathname = usePathname()
  const session = useSession()
  const locale = useLocale()
  // The mobile drawer belongs to the page it was opened on: navigating closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const mobileOpen = drawerPath === pathname
  const setMobileOpen = (open: boolean) => setDrawerPath(open ? pathname : null)

  const toggle = () => setCollapsed(!collapsed)

  return (
    <NotificationsProvider initial={initialNotifications} userId={session.userId}>
      <div
        className="flex min-h-dvh bg-background"
        data-density={session.preferences.density ?? "comfortable"}
      >
        <motion.aside
          animate={{ width: collapsed ? 68 : 248 }}
          transition={{ type: "spring", stiffness: 400, damping: 38 }}
          className="no-print sticky top-0 hidden h-dvh shrink-0 flex-col border-e bg-sidebar md:flex"
        >
          <SidebarContent collapsed={collapsed} />
          <div className="border-t p-2">
            <button
              onClick={toggle}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="size-4 rtl:-scale-x-100" /> : <PanelLeftClose className="size-4 rtl:-scale-x-100" />}
            </button>
          </div>
        </motion.aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side={locale === "ar" ? "right" : "left"} className="w-72 bg-sidebar p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <SidebarContent collapsed={false} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenu={() => setMobileOpen(true)} onSearch={() => palette.setOpen(true)} />
          <main className="min-w-0 flex-1 px-4 pt-4 pb-24 sm:px-6 md:pb-8 lg:px-8">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {children}
            </motion.div>
          </main>
        </div>

        <MobileBottomNav onSearch={() => palette.setOpen(true)} />
        {/* Remounted per opening so the query and pending action start fresh. */}
        <CommandPalette key={palette.open ? "open" : "closed"} open={palette.open} onOpenChange={palette.setOpen} />
      </div>
    </NotificationsProvider>
  )
}

function useIsActive() {
  const pathname = usePathname()
  const search = useSearchParams()
  return (item: NavItem) => {
    const [path, query] = item.href.split("?")
    if (query) return pathname === path && search.toString() === query
    if (item.exact) return pathname === path && !search.get("tab")?.startsWith("tomorrow")
    return pathname === path || pathname.startsWith(`${path}/`)
  }
}

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("nav")
  const can = useCan()
  const refs = useRefs()
  const isActive = useIsActive()
  const main = MAIN_NAV.filter((i) => !i.permissions || can(...i.permissions))
  const admin = ADMIN_NAV.filter((i) => !i.permissions || can(...i.permissions))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Link href="/dashboard" className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10Z" />
            <path d="M12 9v5M9.5 11.5h5" />
          </svg>
        </span>
        {!collapsed && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="truncate text-sm font-semibold">
            {refs.clinicName}
          </motion.span>
        )}
      </Link>
      <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-3" aria-label={t("main")}>
        <NavGroup items={main} collapsed={collapsed} isActive={isActive} />
        {(["clinic", "communication", "security"] as const).map((group) => {
          const items = admin.filter((i) => i.group === group)
          if (items.length === 0) return null
          return (
            <div key={group}>
              {!collapsed && (
                <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t(`group.${group}`)}</p>
              )}
              <NavGroup items={items} collapsed={collapsed} isActive={isActive} />
            </div>
          )
        })}
      </nav>
    </div>
  )
}

function NavGroup({ items, collapsed, isActive }: { items: NavItem[]; collapsed: boolean; isActive: (i: NavItem) => boolean }) {
  const t = useTranslations("nav")
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(item)
        const link = (
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors",
              active
                ? "text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg bg-sidebar-accent"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <item.icon className="relative size-4 shrink-0" />
            {!collapsed && <span className="relative truncate">{t(item.labelKey)}</span>}
          </Link>
        )
        return (
          <li key={item.href}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        )
      })}
    </ul>
  )
}

function MobileBottomNav({ onSearch }: { onSearch: () => void }) {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const can = useCan()
  const items = [
    { href: "/dashboard", icon: LayoutDashboard, label: t("dashboard"), show: true },
    { href: "/patients", icon: Users, label: t("patients"), show: can("patients.view") },
    { href: "/appointments", icon: CalendarDays, label: t("appointments"), show: can("appointments.view") },
  ].filter((i) => i.show)
  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label={t("main")}
    >
      <ul className="grid grid-cols-4">
        {items.map((i) => {
          const active = pathname === i.href || pathname.startsWith(`${i.href}/`)
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <i.icon className="size-5" />
                {i.label}
              </Link>
            </li>
          )
        })}
        <li>
          <button onClick={onSearch} className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground">
            <Search className="size-5" />
            {t("search")}
          </button>
        </li>
      </ul>
    </nav>
  )
}
