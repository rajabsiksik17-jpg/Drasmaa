"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/account"
import { markPatientSent } from "@/lib/actions/encounters"
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

// Queue events that deserve an action button right in the toast.
const QUEUE_TYPES = new Set(["patient_requested", "bill_ready", "patient_checked_in"])

/** Short, soft two-tone chime (Web Audio; no file to download). */
function chime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.16 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.16)
      osc.stop(ctx.currentTime + i * 0.16 + 0.32)
    }
    setTimeout(() => void ctx.close(), 900)
  } catch (error) {
    console.warn("[alerts] sound unavailable", error)
  }
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
          if (QUEUE_TYPES.has(row.type) && prefs.sound_alerts === true) chime()
          const encounterId = row.entity_type === "encounter" ? row.entity_id : null
          const invoiceId = typeof row.data?.invoice_id === "string" ? row.data.invoice_id : null
          if (row.type === "patient_requested" && encounterId) {
            // Reception: one tap to confirm the patient is on the way.
            toast(title, {
              description: body,
              duration: 30_000,
              icon: "🔔",
              action: {
                label: text.label("markSent"),
                onClick: () =>
                  void markPatientSent(encounterId).then((res) => {
                    if (res.ok) toast.success(text.label("markedSent"))
                    router.refresh()
                  }),
              },
            })
          } else if (row.type === "bill_ready") {
            toast(title, {
              description: body,
              duration: 30_000,
              icon: "💳",
              action: { label: text.label("openPayment"), onClick: () => router.push(invoiceId ? `/accounting/invoices/${invoiceId}` : hrefFor(row)) },
            })
          } else {
            const show = row.priority === "critical" ? toast.error : row.priority === "high" ? toast.warning : toast.info
            show(title, {
              description: body,
              duration: row.priority === "critical" ? 15_000 : undefined,
              action: { label: "→", onClick: () => router.push(hrefFor(row)) },
            })
          }
          // Queue changes: refresh the visible lists (targeted server re-render, no reload).
          if (QUEUE_TYPES.has(row.type)) router.refresh()
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
