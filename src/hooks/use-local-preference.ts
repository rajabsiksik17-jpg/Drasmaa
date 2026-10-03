"use client"

import { useCallback, useSyncExternalStore } from "react"

// Non-sensitive UI preferences only (sidebar, panels). Never medical data.
const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Boolean UI preference persisted in localStorage, safe for SSR. */
export function useLocalPreference(key: string, fallback: () => boolean): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      window.addEventListener("storage", cb)
      return () => {
        listeners.delete(cb)
        window.removeEventListener("storage", cb)
      }
    },
    () => {
      const stored = read(key)
      return stored == null ? fallback() : stored === "1"
    },
    () => false,
  )
  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0")
      } catch {
        /* preference only */
      }
      for (const l of listeners) l()
    },
    [key],
  )
  return [value, set]
}
