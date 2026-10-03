"use client"

import { useSyncExternalStore } from "react"

// Hydration-safe access to browser-only values: during SSR and the hydration
// render React uses the *server* snapshot, so the initial HTML is identical on
// both sides; the real value is applied right after hydration.

const noopSubscribe = () => () => {}

/** false on the server and during hydration, true afterwards. */
export function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

interface ClockStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => number
}

// One store per interval with STABLE subscribe/getSnapshot functions.
// Rules that keep useSyncExternalStore from looping:
//   - subscribe/getSnapshot are created once (not inline per render),
//   - the value never changes synchronously inside subscribe; it only
//     changes from timer callbacks, which then notify listeners.
const clocks = new Map<number, ClockStore>()

function clockStore(intervalMs: number): ClockStore {
  const existing = clocks.get(intervalMs)
  if (existing) return existing
  let now = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  const listeners = new Set<() => void>()
  const tick = () => {
    now = Date.now()
    for (const l of listeners) l()
  }
  const store: ClockStore = {
    subscribe(listener) {
      listeners.add(listener)
      if (!timer) {
        timer = setInterval(tick, intervalMs)
        // Refresh a value that may be stale since the last use — asynchronously.
        setTimeout(tick, 0)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    },
    getSnapshot: () => now,
  }
  clocks.set(intervalMs, store)
  return store
}

const serverNow = () => null

/**
 * Current time (ms) refreshed every `intervalMs`, or null on the server and
 * during hydration — never render time-dependent text from Date.now() directly.
 */
export function useNow(intervalMs = 30_000): number | null {
  const store = clockStore(intervalMs)
  return useSyncExternalStore(store.subscribe, store.getSnapshot, serverNow)
}
