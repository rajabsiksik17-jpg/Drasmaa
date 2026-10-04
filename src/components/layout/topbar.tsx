"use client"


import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { motion } from "motion/react"
import { Check, Globe, LogOut, Menu, Monitor, Moon, Search, Settings, Sun, User, Wifi, WifiOff } from "lucide-react"
import { useSession } from "@/components/app-context"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { setLocale, signOut } from "@/lib/actions/account"
import { useConnectionStatus } from "@/lib/realtime/use-realtime"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export function Topbar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const t = useTranslations("topbar")
  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4 lg:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label={t("menu")}>
        <Menu />
      </Button>
      <button
        onClick={onSearch}
        className="group flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition hover:border-ring/40 hover:bg-muted/70"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-start">{t("search")}</span>
        <kbd className="hidden rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] sm:inline-block">Ctrl K</kbd>
      </button>
      <div className="ms-auto flex items-center gap-1">
        <ConnectionIndicator />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}

function ConnectionIndicator() {
  const t = useTranslations("connection")
  const status = useConnectionStatus()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={t(status)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
            status === "connected" && "text-success",
            status === "reconnecting" && "bg-warning/15 text-warning-foreground dark:text-warning",
            status === "offline" && "bg-destructive/10 text-destructive",
          )}
        >
          {status === "offline" ? <WifiOff className="size-3.5" /> : <Wifi className="size-3.5" />}
          <span className={cn(status === "connected" && "sr-only sm:not-sr-only sm:hidden lg:inline")}>{t(status)}</span>
          {status === "connected" && (
            <motion.span
              className="size-1.5 rounded-full bg-success"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2.4, repeat: Infinity }}
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t(`${status}Hint`)}</TooltipContent>
    </Tooltip>
  )
}

function UserMenu() {
  const t = useTranslations("topbar")
  const session = useSession()
  const locale = useLocale()
  const { theme, setTheme } = useTheme()
  const [pending, startTransition] = useSafeTransition()
  const initials = session.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
  const roleName = locale === "ar" ? session.roleNameAr : session.roleNameEn

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label={t("account")}>
          <span className="grid size-7 place-items-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
            {initials || <User className="size-4" />}
          </span>
          <span className="hidden max-w-36 flex-col items-start leading-tight lg:flex">
            <span className="truncate text-sm font-medium">{session.fullName}</span>
            <span className="truncate text-[11px] text-muted-foreground">{roleName}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{session.fullName}</div>
          <div className="truncate text-xs text-muted-foreground">{session.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={pending}>
            <Globe />
            {t("language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(["en", "ar"] as const).map((l) => (
              <DropdownMenuItem key={l} onSelect={() => startTransition(async () => void (await setLocale(l)))}>
                {l === "en" ? "English" : "العربية"}
                {locale === l && <Check className="ms-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "dark" ? <Moon /> : theme === "system" ? <Monitor /> : <Sun />}
            {t("theme")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(
              [
                ["light", Sun],
                ["dark", Moon],
                ["system", Monitor],
              ] as const
            ).map(([value, Icon]) => (
              <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
                <Icon />
                {t(`theme_${value}`)}
                {theme === value && <Check className="ms-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            {t("settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => startTransition(() => signOut())}>
          <LogOut />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
