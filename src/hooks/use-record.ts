"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { saveRecord } from "@/lib/actions/records"
import { useRealtime } from "@/lib/realtime/use-realtime"
import { useRegisterTracker, type SaveStatus, type SaveTracker } from "@/components/forms/save-state"
import { useCorrectionReason, useRecordLocked } from "@/components/forms/correction-context"
import type { ErrorCode } from "@/lib/errors"

type Row = { version: number }

// Rows are plain DB records; read a column by name.
const col = (row: object, key: string): unknown => (row as Record<string, unknown>)[key]

export interface RecordController<T extends Row> {
  values: T
  set: <K extends keyof T>(field: K, value: T[K]) => void
  setMany: (patch: Partial<T>) => void
  status: SaveStatus
  errorCode: ErrorCode | null
  lastSavedAt: number | null
  /** Newer server version when a conflict was detected. */
  conflict: T | null
  /** Fields recently changed by someone else (for a subtle flash). */
  remoteChanged: ReadonlySet<string>
  pendingFields: ReadonlySet<string>
  flush: () => Promise<boolean>
  retry: () => void
  reloadLatest: () => void
  keepMine: () => void
  readOnly: boolean
}

interface Options<T extends Row> {
  table: string
  /** Primary-key column used for updates and realtime filtering. */
  keyField: "id" | "patient_id" | "visit_id"
  row: T
  debounceMs?: number
  realtime?: boolean
  readOnly?: boolean
}

/**
 * Local editing state for one database row with debounced autosave,
 * optimistic concurrency (version), realtime merge and conflict detection.
 * The server row is the source of truth; local state is only a draft
 * that is persisted as soon as the user pauses.
 */
export function useRecord<T extends Row>({
  table,
  keyField,
  row,
  debounceMs = 800,
  realtime = true,
  readOnly: readOnlyProp = false,
}: Options<T>): RecordController<T> {
  const locked = useRecordLocked()
  const readOnly = readOnlyProp || locked
  const key = String(col(row, keyField))
  const reason = useCorrectionReason()
  const [values, setValues] = useState<T>(row)
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [conflict, setConflict] = useState<T | null>(null)
  const [remoteChanged, setRemoteChanged] = useState<ReadonlySet<string>>(new Set())
  const [pendingFields, setPendingFields] = useState<ReadonlySet<string>>(new Set())

  const base = useRef<T>(row) // last confirmed server row
  const local = useRef<T>(row)
  const pending = useRef<Set<string>>(new Set())
  const inflight = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conflictRef = useRef<T | null>(null)
  const reasonRef = useRef(reason)
  useEffect(() => {
    reasonRef.current = reason
  }, [reason])

  const syncPending = () => setPendingFields(new Set(pending.current))
  // Latest save function, for re-scheduling from inside itself.
  const saveRef = useRef<() => Promise<boolean>>(async () => true)

  const doSave = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inflight.current) {
      await inflight.current
    }
    if (conflictRef.current) return false
    if (pending.current.size === 0) return true
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline")
      return false
    }

    const fields = [...pending.current]
    const patch: Record<string, unknown> = {}
    for (const f of fields) patch[f] = col(local.current, f)

    setStatus("saving")
    const run = (async () => {
      try {
        const res = await saveRecord({
          table,
          key,
          patch,
          expectedVersion: base.current.version,
          reason: reasonRef.current,
        })
        if (res.ok) {
          const saved = res.data.row as T
          base.current = saved
          // Only clear fields whose value did not change again meanwhile.
          for (const f of fields) {
            if (Object.is(col(local.current, f), patch[f])) pending.current.delete(f)
          }
          local.current = { ...saved, ...Object.fromEntries([...pending.current].map((f) => [f, col(local.current, f)])) } as T
          setValues(local.current)
          setLastSavedAt(Date.now())
          setErrorCode(null)
          syncPending()
          setStatus(pending.current.size ? "pending" : "saved")
          return true
        }
        if (res.error.code === "conflict" && res.latest) {
          conflictRef.current = res.latest as T
          setConflict(res.latest as T)
          setStatus("conflict")
          return false
        }
        setErrorCode(res.error.code)
        setStatus("error")
        return false
      } catch {
        setErrorCode(typeof navigator !== "undefined" && !navigator.onLine ? "network" : "unexpected")
        setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error")
        return false
      }
    })()
    inflight.current = run
    const result = await run
    inflight.current = null
    if (result && pending.current.size) {
      // Changes typed while saving: schedule the next round.
      timer.current = setTimeout(() => void saveRef.current(), debounceMs)
    }
    return result
  }, [table, key, debounceMs])

  useEffect(() => {
    saveRef.current = doSave
  }, [doSave])

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setStatus((s) => (s === "conflict" ? s : "pending"))
    timer.current = setTimeout(() => void doSave(), debounceMs)
  }, [doSave, debounceMs])

  const setMany = useCallback(
    (patch: Partial<T>) => {
      if (readOnly) return
      local.current = { ...local.current, ...patch }
      for (const f of Object.keys(patch)) pending.current.add(f)
      setValues(local.current)
      syncPending()
      schedule()
    },
    [readOnly, schedule],
  )

  const set = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => setMany({ [field]: value } as unknown as Partial<T>),
    [setMany],
  )

  const retry = useCallback(() => {
    setErrorCode(null)
    void doSave()
  }, [doSave])

  const reloadLatest = useCallback(() => {
    const latest = conflictRef.current
    if (!latest) return
    conflictRef.current = null
    pending.current.clear()
    base.current = latest
    local.current = latest
    setValues(latest)
    setConflict(null)
    syncPending()
    setStatus("saved")
  }, [])

  const keepMine = useCallback(() => {
    const latest = conflictRef.current
    if (!latest) return
    conflictRef.current = null
    base.current = latest
    setConflict(null)
    // Re-apply only the user's own pending fields on top of the newest row.
    local.current = { ...latest, ...Object.fromEntries([...pending.current].map((f) => [f, col(local.current, f)])) } as T
    setValues(local.current)
    void doSave()
  }, [doSave])

  // A newer server row arrived through a re-render (router.refresh()).
  useEffect(() => {
    if (row.version > base.current.version && pending.current.size === 0 && !inflight.current && !conflictRef.current) {
      base.current = row
      local.current = row
      setValues(row)
    }
  }, [row])

  // Retry automatically when the connection comes back.
  useEffect(() => {
    const onOnline = () => {
      if (pending.current.size) void doSave()
    }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [doSave])

  // Never drop unsaved edits on navigation: flush on unmount.
  useEffect(
    () => () => {
      if (pending.current.size && !conflictRef.current) void doSave()
    },
    [doSave],
  )

  // Realtime: apply other users' changes when we have nothing pending;
  // otherwise surface a conflict instead of silently overwriting.
  useRealtime(
    realtime ? `rec:${table}:${key}` : null,
    [{ table, filter: `${keyField}=eq.${key}`, event: "UPDATE" }],
    (payload) => {
      const incoming = payload.new as T
      if (!incoming || typeof incoming.version !== "number") return
      if (incoming.version <= base.current.version) return
      if (inflight.current) return // our own save will report the outcome
      const changed = Object.keys(incoming).filter(
        (k) => !["updated_at", "updated_by", "version"].includes(k) && !Object.is(col(incoming, k), col(base.current, k)),
      )
      if (pending.current.size === 0) {
        base.current = incoming
        local.current = incoming
        setValues(incoming)
        setRemoteChanged(new Set(changed))
        setTimeout(() => setRemoteChanged(new Set()), 1600)
      } else {
        conflictRef.current = incoming
        setConflict(incoming)
        setStatus("conflict")
      }
    },
  )

  const tracker = useMemo<SaveTracker>(
    () => ({ status, lastSavedAt, dirty: pendingFields.size > 0, flush: doSave, retry }),
    [status, lastSavedAt, pendingFields, doSave, retry],
  )
  useRegisterTracker(tracker)

  return {
    values,
    set,
    setMany,
    status,
    errorCode,
    lastSavedAt,
    conflict,
    remoteChanged,
    pendingFields,
    flush: doSave,
    retry,
    reloadLatest,
    keepMine,
    readOnly,
  }
}
