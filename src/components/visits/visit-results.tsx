"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { saveVisitResult, requestInvestigations } from "@/lib/actions/clinical"
import { saveRecord } from "@/lib/actions/records"
import { useRegisterTracker, type SaveStatus, type SaveTracker } from "@/components/forms/save-state"
import { useCorrectionReason, useRecordLocked } from "@/components/forms/correction-context"
import { useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { clinicToday, formatDate } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { Investigation, InvestigationResult } from "@/types/db"

interface Entry {
  id: string | null
  version: number | null
  value: string
}

interface Ctx {
  get: (code: string) => string
  set: (code: string, value: string) => void
  previous: (code: string) => InvestigationResult | undefined
  readOnly: boolean
}

const ResultsContext = createContext<Ctx | null>(null)

const asText = (r: InvestigationResult) => (r.value_numeric != null ? String(r.value_numeric) : (r.value_text ?? ""))

/**
 * Results captured inside a visit (one per type per visit). The original
 * laboratory history is never touched: previous results are shown as hints.
 */
export function VisitResultsProvider({
  patientId,
  visitId,
  initial,
  previous,
  readOnly,
  children,
}: {
  patientId: string
  visitId: string
  initial: InvestigationResult[]
  previous: InvestigationResult[]
  readOnly: boolean
  children: React.ReactNode
}) {
  const reason = useCorrectionReason()
  const locked = useRecordLocked()
  const { showError } = useActionError()
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(initial.map((r) => [r.type_code, { id: r.id, version: r.version, value: asText(r) }])),
  )
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const pending = useRef(new Set<string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const latest = useRef(entries)
  useEffect(() => {
    latest.current = entries
  }, [entries])

  const saveOne = useCallback(
    async (code: string) => {
      const entry = latest.current[code]
      if (!entry) return true
      setStatus("saving")
      let res: Awaited<ReturnType<typeof saveVisitResult>>
      try {
        res = await saveVisitResult({
        patientId,
        visitId,
        typeCode: code,
        value: entry.value,
        expectedVersion: entry.version,
        reason,
        })
      } catch {
        setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error")
        return false
      }
      if (!res.ok) {
        setStatus(res.error.code === "conflict" ? "conflict" : "error")
        showError(res.error)
        return false
      }
      pending.current.delete(code)
      if (res.data) {
        setEntries((prev) => ({ ...prev, [code]: { ...prev[code], id: res.data!.id, version: res.data!.version } }))
      }
      setSavedAt(Date.now())
      setStatus(pending.current.size ? "pending" : "saved")
      return true
    },
    [patientId, visitId, reason, showError],
  )

  const flush = useCallback(async () => {
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear()
    const results = await Promise.all([...pending.current].map((c) => saveOne(c)))
    return results.every(Boolean)
  }, [saveOne])

  const set = useCallback(
    (code: string, value: string) => {
      setEntries((prev) => ({ ...prev, [code]: { id: prev[code]?.id ?? null, version: prev[code]?.version ?? null, value } }))
      latest.current = { ...latest.current, [code]: { id: latest.current[code]?.id ?? null, version: latest.current[code]?.version ?? null, value } }
      pending.current.add(code)
      setStatus("pending")
      const existing = timers.current.get(code)
      if (existing) clearTimeout(existing)
      timers.current.set(code, setTimeout(() => void saveOne(code), 900))
    },
    [saveOne],
  )

  useEffect(() => () => void flush(), [flush])

  const tracker = useMemo<SaveTracker>(
    () => ({ status, lastSavedAt: savedAt, dirty: status === "pending" || status === "saving" || status === "error", flush, retry: () => void flush() }),
    [status, savedAt, flush],
  )
  useRegisterTracker(tracker)

  const value = useMemo<Ctx>(
    () => ({
      get: (code) => entries[code]?.value ?? "",
      set,
      previous: (code) => previous.find((p) => p.type_code === code),
      readOnly: readOnly || locked,
    }),
    [entries, set, previous, readOnly, locked],
  )
  return <ResultsContext.Provider value={value}>{children}</ResultsContext.Provider>
}

export function useVisitResults() {
  const ctx = useContext(ResultsContext)
  if (!ctx) throw new Error("useVisitResults outside provider")
  return ctx
}

/** Paper-styled result input with the previous value as a hint. */
export function ResultField({ code, label, className }: { code: string; label: string; className?: string }) {
  const t = useTranslations("investigations")
  const results = useVisitResults()
  const prev = results.previous(code)
  return (
    <span className={cn("inline-flex min-w-0 flex-1 flex-col", className)}>
      <input
        aria-label={label}
        className="paper-input paper-line tabular-nums"
        value={results.get(code)}
        disabled={results.readOnly}
        maxLength={40}
        onChange={(e) => results.set(code, e.target.value)}
      />
      {prev && (
        <button
          type="button"
          className="mt-0.5 self-start text-[11px] text-[color:var(--paper-muted)] hover:text-[#2a8a9b] disabled:pointer-events-none"
          disabled={results.readOnly || !!results.get(code)}
          onClick={() => results.set(code, asText(prev))}
          title={t("usePrevious")}
        >
          {t("previousValue", { value: asText(prev), date: formatDate(prev.result_date) })}
        </button>
      )}
    </span>
  )
}

/** Requested / performed (record) vs result — kept separate as required. */
export function VisitInvestigations({
  context,
  patientId,
  visitId,
  investigations,
  canEdit,
}: {
  context: "gynecology" | "fertility" | "pregnancy"
  patientId: string
  visitId: string
  investigations: Investigation[]
  canEdit: boolean
}) {
  const t = useTranslations("investigations")
  const refs = useRefs()
  const router = useRouter()
  const locked = useRecordLocked()
  const reason = useCorrectionReason()
  const { showError } = useActionError()
  const [pending, start] = useTransition()
  const types = refs.investigationTypes.filter((x) => x.active && x.contexts.includes(context))
  const byType = new Map(investigations.map((i) => [i.type_code, i]))
  const editable = canEdit && !locked

  const toggleRequested = (code: string) =>
    start(async () => {
      const existing = byType.get(code)
      const res = existing
        ? await saveRecord({
            table: "investigations",
            key: existing.id,
            patch: { status: existing.status === "cancelled" ? "requested" : "cancelled" },
            expectedVersion: existing.version,
            reason,
          })
        : await requestInvestigations({ patientId, visitId, typeCodes: [code] })
      if (!res.ok) return showError(res.error)
      router.refresh()
    })

  const togglePerformed = (inv: Investigation) =>
    start(async () => {
      const performed = inv.status !== "performed"
      const res = await saveRecord({
        table: "investigations",
        key: inv.id,
        patch: { status: performed ? "performed" : "requested", performed_on: performed ? clinicToday() : null },
        expectedVersion: inv.version,
        reason,
      })
      if (!res.ok) return showError(res.error)
      router.refresh()
    })

  return (
    <div className="scroll-x">
      <table className="paper-grid w-full min-w-[520px] text-[13px]">
        <thead>
          <tr className="bg-[color:var(--paper-fill)]">
            <th className="px-2 py-1 text-start font-bold">{t("test")}</th>
            <th className="w-24 px-2 py-1 font-bold">{t("requested")}</th>
            <th className="w-24 px-2 py-1 font-bold">{t("performed")}</th>
            <th className="px-2 py-1 font-bold">{t("result")}</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => {
            const inv = byType.get(type.code)
            const requested = !!inv && inv.status !== "cancelled"
            return (
              <tr key={type.code}>
                <td className="px-2 py-1">
                  {refs.pick(type.name_en, type.name_ar)}
                  {type.unit && <span className="ms-1 text-[11px] text-[color:var(--paper-muted)]">({type.unit})</span>}
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    className="paper-check"
                    checked={requested}
                    disabled={!editable || pending}
                    onChange={() => toggleRequested(type.code)}
                    aria-label={`${t("requested")} ${type.name_en}`}
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    className="paper-check"
                    checked={inv?.status === "performed"}
                    disabled={!editable || pending || !requested}
                    onChange={() => inv && togglePerformed(inv)}
                    aria-label={`${t("performed")} ${type.name_en}`}
                  />
                </td>
                <td className="px-1 py-0.5">
                  <ResultField code={type.code} label={`${t("result")} ${type.name_en}`} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
