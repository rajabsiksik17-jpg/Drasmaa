"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { getBrowserClient } from "@/lib/supabase/client"
import { isSupabaseConfigured } from "@/lib/supabase/env"

export type ConnectionStatus = "connected" | "reconnecting" | "offline"

// ---------------------------------------------------------------------
// Connection status store (browser online state + realtime channel state)
// ---------------------------------------------------------------------
let status: ConnectionStatus = "connected"
const listeners = new Set<() => void>()
const channelStates = new Map<string, string>()

function computeStatus(): ConnectionStatus {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline"
  for (const state of channelStates.values()) {
    if (state !== "SUBSCRIBED") return "reconnecting"
  }
  return "connected"
}

function emit() {
  const next = computeStatus()
  if (next !== status) {
    status = next
    for (const l of listeners) l()
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", emit)
  window.addEventListener("offline", emit)
}

export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => status,
    () => "connected",
  )
}

// ---------------------------------------------------------------------
// Scoped postgres_changes subscriptions (RLS applies to delivery).
// ---------------------------------------------------------------------
export interface RealtimeSpec {
  table: string
  /** PostgREST-style filter, e.g. `patient_id=eq.<uuid>` — always scope! */
  filter?: string
  event?: "INSERT" | "UPDATE" | "DELETE" | "*"
}

export function useRealtime(
  channelKey: string | null,
  specs: RealtimeSpec[],
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
) {
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  })
  const specsKey = JSON.stringify(specs)

  useEffect(() => {
    if (!channelKey || !isSupabaseConfigured) return
    const supabase = getBrowserClient()
    const name = `${channelKey}:${Math.random().toString(36).slice(2, 8)}`
    let channel = supabase.channel(name)
    for (const spec of JSON.parse(specsKey) as RealtimeSpec[]) {
      channel = channel.on(
        "postgres_changes" as never,
        { event: spec.event ?? "*", schema: "public", table: spec.table, filter: spec.filter } as never,
        ((payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => handler.current(payload)) as never,
      )
    }
    channelStates.set(name, "CONNECTING")
    emit()
    channel.subscribe((state: string) => {
      channelStates.set(name, state)
      emit()
    })
    return () => {
      channelStates.delete(name)
      emit()
      void supabase.removeChannel(channel)
    }
  }, [channelKey, specsKey])
}

/** Debounced callback helper for "refresh the server-rendered view" on changes. */
export function useDebouncedCallback<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(fn)
  useEffect(() => {
    latest.current = fn
  })
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (...args: T) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current(...args), ms)
  }
}
