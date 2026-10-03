"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { saveCycleCell } from "@/lib/actions/records"
import { useRealtime } from "@/lib/realtime/use-realtime"
import { useRegisterTracker, type SaveStatus, type SaveTracker } from "@/components/forms/save-state"
import { useCorrectionReason } from "@/components/forms/correction-context"
import { useActionError } from "@/hooks/use-action-error"
import type { CycleEndometrium, CycleFollicle, CycleMedication } from "@/types/db"

export type CellTable = "fertility_cycle_medications" | "fertility_cycle_follicles" | "fertility_cycle_endometrium"

export interface CellKeys {
  medication_code?: string
  day_number: number
  side?: "R" | "L"
  row_index?: number
}

interface CellState {
  value: string
  version: number | null
}

export function cellKey(table: CellTable, k: CellKeys) {
  if (table === "fertility_cycle_medications") return `m|${k.medication_code}|${k.day_number}`
  if (table === "fertility_cycle_follicles") return `f|${k.day_number}|${k.side}|${k.row_index}`
  return `e|${k.day_number}`
}

function rowKey(table: CellTable, row: Record<string, unknown>) {
  return cellKey(table, {
    medication_code: row.medication_code as string | undefined,
    day_number: row.day_number as number,
    side: row.side as "R" | "L" | undefined,
    row_index: row.row_index as number | undefined,
  })
}

const FIELD: Record<CellTable, "value" | "size"> = {
  fertility_cycle_medications: "value",
  fertility_cycle_follicles: "size",
  fertility_cycle_endometrium: "value",
}

/**
 * All O/I grid cells of one cycle. Each cell autosaves independently
 * (debounced), with version checks; other users' edits stream in live.
 */
export function useCycleCells({
  cycleId,
  medications,
  follicles,
  endometrium,
}: {
  cycleId: string
  medications: CycleMedication[]
  follicles: CycleFollicle[]
  endometrium: CycleEndometrium[]
}) {
  const t = useTranslations("oi")
  const reason = useCorrectionReason()
  const { showError } = useActionError()
  const initial = useMemo(() => {
    const m = new Map<string, CellState>()
    for (const r of medications) m.set(rowKey("fertility_cycle_medications", r as never), { value: r.value ?? "", version: r.version })
    for (const r of follicles) m.set(rowKey("fertility_cycle_follicles", r as never), { value: r.size ?? "", version: r.version })
    for (const r of endometrium) m.set(rowKey("fertility_cycle_endometrium", r as never), { value: r.value ?? "", version: r.version })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [cells, setCells] = useState(initial)
  const cellsRef = useRef(initial)
  const meta = useRef(new Map<string, { table: CellTable; keys: CellKeys }>())
  const pending = useRef(new Set<string>())
  const inflight = useRef(new Set<string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set())
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const reasonRef = useRef(reason)
  useEffect(() => {
    reasonRef.current = reason
  }, [reason])

  const write = (key: string, state: CellState) => {
    const next = new Map(cellsRef.current)
    next.set(key, state)
    cellsRef.current = next
    setCells(next)
  }

  const recompute = () => setStatus(inflight.current.size ? "saving" : pending.current.size ? "pending" : "saved")
  // Latest saveCell, so a cell can re-schedule itself.
  const saveRef = useRef<(key: string) => Promise<boolean>>(async () => true)

  const saveCell = useCallback(
    async (key: string): Promise<boolean> => {
      const m = meta.current.get(key)
      const state = cellsRef.current.get(key)
      if (!m || !state) return true
      if (inflight.current.has(key)) {
        // One request per cell at a time; retry right after the current one.
        timers.current.set(key, setTimeout(() => void saveRef.current(key), 300))
        return true
      }
      inflight.current.add(key)
      pending.current.delete(key)
      setStatus("saving")
      let res: Awaited<ReturnType<typeof saveCycleCell>>
      try {
        res = await saveCycleCell({
        table: m.table,
        cycleId,
        keys: m.keys as never,
        value: state.value,
        expectedVersion: state.version,
        reason: reasonRef.current,
        })
      } catch {
        // Thrown failures (network down): keep the cell pending for retry.
        inflight.current.delete(key)
        pending.current.add(key)
        setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error")
        return false
      }
      inflight.current.delete(key)
      if (res.ok) {
        const row = res.data.row
        const current = cellsRef.current.get(key)
        // Keep newer local typing; adopt the server version.
        write(key, { value: current?.value ?? String(row[FIELD[m.table]] ?? ""), version: row.version as number })
        setSavedAt(Date.now())
        recompute()
        return true
      }
      if (res.error.code === "conflict" && res.latest) {
        write(key, { value: String(res.latest[FIELD[m.table]] ?? ""), version: res.latest.version as number })
        toast.warning(t("cellConflict"))
        recompute()
        return false
      }
      pending.current.add(key)
      setStatus("error")
      showError(res.error)
      return false
    },
    [cycleId, showError, t],
  )
  useEffect(() => {
    saveRef.current = saveCell
  }, [saveCell])

  const set = useCallback(
    (table: CellTable, keys: CellKeys, value: string) => {
      const key = cellKey(table, keys)
      meta.current.set(key, { table, keys })
      const prev = cellsRef.current.get(key)
      write(key, { value, version: prev?.version ?? null })
      pending.current.add(key)
      setStatus("pending")
      const existing = timers.current.get(key)
      if (existing) clearTimeout(existing)
      timers.current.set(key, setTimeout(() => void saveCell(key), 700))
    },
    [saveCell],
  )

  const flush = useCallback(async () => {
    for (const tm of timers.current.values()) clearTimeout(tm)
    timers.current.clear()
    const results = await Promise.all([...pending.current].map((k) => saveCell(k)))
    return results.every(Boolean)
  }, [saveCell])

  useEffect(() => () => void flush(), [flush])

  useRealtime(
    `cells:${cycleId}`,
    [
      { table: "fertility_cycle_medications", filter: `cycle_id=eq.${cycleId}` },
      { table: "fertility_cycle_follicles", filter: `cycle_id=eq.${cycleId}` },
      { table: "fertility_cycle_endometrium", filter: `cycle_id=eq.${cycleId}` },
    ],
    (payload) => {
      const row = payload.new as Record<string, unknown>
      if (!row || typeof row.version !== "number") return
      const table = payload.table as CellTable
      const key = rowKey(table, row)
      const current = cellsRef.current.get(key)
      if (current?.version != null && current.version >= (row.version as number)) return
      if (pending.current.has(key) || inflight.current.has(key)) return // our save will reconcile
      write(key, { value: String(row[FIELD[table]] ?? ""), version: row.version as number })
      setFlash(new Set([key]))
      setTimeout(() => setFlash(new Set()), 1400)
    },
  )

  const tracker = useMemo<SaveTracker>(
    () => ({
      status,
      lastSavedAt: savedAt,
      dirty: status === "pending" || status === "saving" || status === "error",
      flush,
      retry: () => void flush(),
    }),
    [status, savedAt, flush],
  )
  useRegisterTracker(tracker)

  const get = useCallback((table: CellTable, keys: CellKeys) => cells.get(cellKey(table, keys))?.value ?? "", [cells])
  const isFlashing = useCallback((table: CellTable, keys: CellKeys) => flash.has(cellKey(table, keys)), [flash])

  return { get, set, isFlashing, flush }
}
