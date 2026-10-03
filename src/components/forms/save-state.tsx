"use client"

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle, Check, CloudOff, Loader2, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/dates"

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "conflict" | "offline"

export interface SaveTracker {
  status: SaveStatus
  lastSavedAt: number | null
  dirty: boolean
  flush: () => Promise<boolean>
  retry: () => void
}

/**
 * Collects the save state of every autosaving record on a page so the
 * user always sees ONE truthful status: Saving… / Saved hh:mm / Failed.
 * "Saved" is only shown after the server confirmed every change.
 */
class SaveRegistry {
  private trackers = new Map<string, SaveTracker>()
  private listeners = new Set<() => void>()
  private snapshot = { status: "idle" as SaveStatus, lastSavedAt: null as number | null, dirty: false }

  set(id: string, tracker: SaveTracker) {
    this.trackers.set(id, tracker)
    this.recompute()
  }
  remove(id: string) {
    this.trackers.delete(id)
    this.recompute()
  }
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  getSnapshot = () => this.snapshot
  async flushAll() {
    const results = await Promise.all([...this.trackers.values()].map((t) => t.flush()))
    return results.every(Boolean)
  }
  retryAll() {
    for (const t of this.trackers.values()) if (t.status === "error" || t.status === "offline") t.retry()
  }
  private recompute() {
    const all = [...this.trackers.values()]
    const has = (s: SaveStatus) => all.some((t) => t.status === s)
    const status: SaveStatus = has("conflict")
      ? "conflict"
      : has("error")
        ? "error"
        : has("offline")
          ? "offline"
          : has("saving")
            ? "saving"
            : has("pending")
              ? "pending"
              : has("saved")
                ? "saved"
                : "idle"
    const lastSavedAt = all.reduce<number | null>((m, t) => (t.lastSavedAt && (!m || t.lastSavedAt > m) ? t.lastSavedAt : m), null)
    const dirty = all.some((t) => t.dirty || t.status === "saving")
    const prev = this.snapshot
    if (prev.status !== status || prev.lastSavedAt !== lastSavedAt || prev.dirty !== dirty) {
      this.snapshot = { status, lastSavedAt, dirty }
      for (const l of this.listeners) l()
    }
  }
}

const SaveContext = createContext<SaveRegistry | null>(null)

export function FormSaveProvider({ children, guard = true }: { children: React.ReactNode; guard?: boolean }) {
  const [registry] = useState(() => new SaveRegistry())
  return (
    <SaveContext.Provider value={registry}>
      {children}
      {guard && <UnsavedChangesGuard />}
    </SaveContext.Provider>
  )
}

export function useSaveRegistry() {
  return useContext(SaveContext)
}

export function useRegisterTracker(tracker: SaveTracker) {
  const registry = useContext(SaveContext)
  const id = useId()
  useEffect(() => {
    registry?.set(id, tracker)
  }, [registry, id, tracker])
  useEffect(() => () => registry?.remove(id), [registry, id])
}

export function useAggregateSaveState() {
  const registry = useContext(SaveContext)
  const fallback = useMemo(() => ({ status: "idle" as SaveStatus, lastSavedAt: null, dirty: false }), [])
  return useSyncExternalStore(
    registry?.subscribe ?? (() => () => undefined),
    registry?.getSnapshot ?? (() => fallback),
    () => fallback,
  )
}

export function SaveIndicator({ className }: { className?: string }) {
  const t = useTranslations("save")
  const registry = useContext(SaveContext)
  const { status, lastSavedAt } = useAggregateSaveState()
  const locale = useLocale()
  const time = lastSavedAt
    ? formatTime(new Date(lastSavedAt).toISOString(), locale)
    : null

  let content: React.ReactNode = null
  if (status === "saving" || status === "pending") {
    content = (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t("saving")}
      </span>
    )
  } else if (status === "saved" && time) {
    content = (
      <span className="inline-flex items-center gap-1.5 text-success">
        <Check className="size-3.5" />
        {t("savedAt", { time })}
      </span>
    )
  } else if (status === "error") {
    content = (
      <span className="inline-flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-3.5" />
        {t("failed")}
        <Button size="xs" variant="outline" onClick={() => registry?.retryAll()}>
          <RotateCw />
          {t("retry")}
        </Button>
      </span>
    )
  } else if (status === "offline") {
    content = (
      <span className="inline-flex items-center gap-1.5 text-warning-foreground dark:text-warning">
        <CloudOff className="size-3.5" />
        {t("offline")}
      </span>
    )
  } else if (status === "conflict") {
    content = (
      <span className="inline-flex items-center gap-1.5 text-warning-foreground dark:text-warning">
        <AlertTriangle className="size-3.5" />
        {t("conflict")}
      </span>
    )
  } else if (status === "idle") {
    content = <span className="text-muted-foreground">{t("autosave")}</span>
  }

  return (
    <div className={cn("text-xs font-medium", className)} role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          className="inline-flex"
        >
          {content}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

/**
 * Warns before leaving with unsaved/in-flight changes:
 * - tab close / refresh: native beforeunload prompt
 * - in-app links: dialog with Save and Leave / Leave Without Saving / Cancel
 */
function UnsavedChangesGuard() {
  const t = useTranslations("save")
  const registry = useContext(SaveContext)
  const { dirty } = useAggregateSaveState()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
    }
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      setPendingHref(url.pathname + url.search + url.hash)
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [])

  const leave = useCallback((href: string) => {
    setPendingHref(null)
    window.location.assign(href)
  }, [])

  return (
    <AlertDialog open={pendingHref !== null} onOpenChange={(open) => !open && setPendingHref(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("unsavedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("unsavedBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button variant="outline" onClick={() => pendingHref && leave(pendingHref)}>
            {t("leaveWithoutSaving")}
          </Button>
          <AlertDialogAction
            disabled={saving}
            onClick={async (e) => {
              e.preventDefault()
              if (!registry || !pendingHref) return
              setSaving(true)
              const okAll = await registry.flushAll()
              setSaving(false)
              if (okAll) leave(pendingHref)
            }}
          >
            {saving && <Loader2 className="animate-spin" />}
            {t("saveAndLeave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
