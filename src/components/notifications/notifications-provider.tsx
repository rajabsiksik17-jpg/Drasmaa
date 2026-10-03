"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/account"
import { useRealtime } from "@/lib/realtime/use-realtime"
import { useNotificationText } from "@/components/notifications/notification-text"
import { useSession } from "@/components/app-context"
import type { AppNotification } from "@/types/db"

interface NotificationsState {
  items: AppNotification[]
  unread: number
  unreadCritical: number
  /** Increments on every new arrival (drives the badge animation). */
  pulse: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  open: (n: AppNotification) => void
}

const Ctx = createContext<NotificationsState | null>(null)

export function useNotifications() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useNotifications outside provider")
  return ctx
}

export function hrefFor(n: AppNotification) {
  if (n.link && n.link.startsWith("/") && !n.link.startsWith("//")) return n.link
  const patient = n.patient_id ?? (n.data.patient_id as string | undefined)
  if (!patient) return "/notifications"
  if (n.type === "patient_checked_in") return `/patients/${patient}?from=queue`
  return `/patients/${patient}?tab=appointments`
}

export function NotificationsProvider({
  initial,
  userId,
  children,
}: {
  initial: AppNotification[]
  userId: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const session = useSession()
  const text = useNotificationText()
  const [items, setItems] = useState(initial)
  const [pulse, setPulse] = useState(0)

  useRealtime(
    `notif:${userId}`,
    [{ table: "notifications", filter: `recipient_id=eq.${userId}` }],
    (payload) => {
      const row = payload.new as AppNotification
      if (payload.eventType === "INSERT" && row?.id) {
        setItems((prev) => [row, ...prev.filter((p) => p.id !== row.id)].slice(0, 50))
        setPulse((p) => p + 1)
        const prefs = session.preferences
        const muted =
          (row.type === "patient_checked_in" && prefs.notify_checkin === false) ||
          (row.type === "appointment_reminder" && prefs.notify_reminders === false)
        if (!muted) {
          const { title, body } = text(row)
          const show = row.priority === "critical" ? toast.error : row.priority === "high" ? toast.warning : toast.info
          show(title, {
            description: body,
            duration: row.priority === "critical" ? 15_000 : undefined,
            action: { label: "→", onClick: () => router.push(hrefFor(row)) },
          })
        }
      } else if (payload.eventType === "UPDATE" && row?.id) {
        setItems((prev) =>
          row.voided_at ? prev.filter((p) => p.id !== row.id) : prev.map((p) => (p.id === row.id ? row : p)),
        )
      }
    },
  )

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((p) => (p.id === id && !p.read_at ? { ...p, read_at: new Date().toISOString() } : p)))
    await markNotificationRead(id)
  }, [])

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setItems((prev) => prev.map((p) => (p.read_at ? p : { ...p, read_at: now })))
    await markAllNotificationsRead()
  }, [])

  const open = useCallback(
    (n: AppNotification) => {
      void markRead(n.id)
      router.push(hrefFor(n))
    },
    [markRead, router],
  )

  const value = useMemo<NotificationsState>(
    () => ({
      items: items.filter((i) => !i.voided_at),
      unread: items.filter((i) => !i.read_at && !i.voided_at).length,
      unreadCritical: items.filter((i) => !i.read_at && !i.voided_at && i.priority === "critical").length,
      pulse,
      markRead,
      markAllRead,
      open,
    }),
    [items, pulse, markRead, markAllRead, open],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
