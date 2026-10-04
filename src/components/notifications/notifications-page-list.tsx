"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NotificationList } from "@/components/notifications/notification-bell"
import { useNotifications } from "@/components/notifications/notifications-provider"
import { listNotifications } from "@/lib/actions/account"
import { cn } from "@/lib/utils"
import type { AppNotification, NotificationCategory } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

const CATEGORIES: NotificationCategory[] = ["appointments", "patients", "medical", "security", "admin", "system"]

/**
 * Full history: the live list from the provider (realtime) plus older
 * pages fetched on demand with server-side filtering.
 */
export function NotificationsPageList() {
  const t = useTranslations("notifications")
  const { items: live, unread, markAllRead } = useNotifications()
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [category, setCategory] = useState<NotificationCategory | null>(null)
  const [older, setOlder] = useState<AppNotification[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [pending, startTransition] = useSafeTransition()

  const liveIds = new Set(live.map((i) => i.id))
  const merged = [...live, ...older.filter((o) => !liveIds.has(o.id))]
  const shown = merged.filter((i) => (filter === "unread" ? !i.read_at : true) && (category ? i.category === category : true))

  const reset = (next: () => void) => {
    next()
    setOlder([])
    setExhausted(false)
  }

  const loadMore = () =>
    startTransition(async () => {
      const last = shown.at(-1) ?? merged.at(-1)
      const res = await listNotifications({
        before: last?.created_at,
        category: category ?? undefined,
        unreadOnly: filter === "unread",
      })
      if (!res.ok) return
      setOlder((prev) => [...prev, ...res.data.filter((n) => !prev.some((p) => p.id === n.id))])
      if (res.data.length < 30) setExhausted(true)
    })

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
      active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button key={f} onClick={() => reset(() => setFilter(f))} className={chip(filter === f)}>
            {t(f)} {f === "unread" && unread > 0 ? `(${unread})` : ""}
          </button>
        ))}
        {unread > 0 && (
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => void markAllRead()}>
            <CheckCheck />
            {t("markAll")}
          </Button>
        )}
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <button onClick={() => reset(() => setCategory(null))} className={chip(category === null)}>
          {t("allCategories")}
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => reset(() => setCategory(c))} className={chip(category === c)}>
            {t(`category.${c}`)}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <NotificationList items={shown} />
      </div>
      {!exhausted && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  )
}
