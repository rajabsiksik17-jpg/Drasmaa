"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { BarChart3, FileSpreadsheet, LayoutDashboard, Receipt, ShieldCheck, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"

const ITEMS = [
  { href: "/accounting", key: "dashboard", icon: LayoutDashboard, exact: true },
  { href: "/accounting/invoices", key: "invoices", icon: Receipt },
  { href: "/accounting/register", key: "register", icon: Wallet },
  { href: "/accounting/insurance", key: "insurance", icon: ShieldCheck },
  { href: "/accounting/reports", key: "reports", icon: BarChart3 },
  { href: "/accounting/payments", key: "payments", icon: FileSpreadsheet },
] as const

export function AccountingNav() {
  const t = useTranslations("accounting.nav")
  const pathname = usePathname()
  return (
    <nav className="no-print -mx-1 overflow-x-auto px-1" aria-label={t("label")}>
      <div className="flex min-w-max gap-0.5 border-b">
        {ITEMS.map((item) => {
          const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative inline-flex items-center gap-1.5 px-3 pt-1.5 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {t(item.key)}
              {active && <motion.span layoutId="accounting-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
