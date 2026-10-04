"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { ArrowDown, ArrowUp, Check, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { NativeSelect } from "@/components/common/native-select"
import { useActionError } from "@/hooks/use-action-error"
import { reorderConfigRows, saveConfigRow, type ConfigTable } from "@/lib/actions/admin"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface ConfigColumn {
  key: string
  label: string
  type?: "text" | "code" | "select" | "color"
  options?: { value: string; label: string }[]
  /** Not editable after creation (e.g. option value referenced by history). */
  immutable?: boolean
  dir?: "ltr" | "rtl"
  width?: string
}

type Row = Record<string, unknown> & { id: string; active: boolean; sort_order: number }

/**
 * Admin list editor for configurable reference data. Rows are never
 * deleted (history may reference them) — they are deactivated instead.
 */
export function ConfigEditor({
  table,
  rows: initial,
  columns,
  fixed = {},
}: {
  table: ConfigTable
  rows: Row[]
  columns: ConfigColumn[]
  fixed?: Record<string, unknown>
}) {
  const t = useTranslations("admin")
  const router = useRouter()
  const { showError } = useActionError()
  const [rows, setRows] = useState(initial)
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({})
  const [adding, setAdding] = useState<Record<string, unknown> | null>(null)
  const [pending, start] = useSafeTransition()
  const [savedId, setSavedId] = useState<string | null>(null)

  const dirty = (id: string) => Object.keys(drafts[id] ?? {}).length > 0
  const value = (r: Row, k: string) => (drafts[r.id]?.[k] ?? r[k] ?? "") as string

  const saveRow = (r: Row, patch?: Record<string, unknown>) =>
    start(async () => {
      const values = patch ?? drafts[r.id]
      if (!values) return
      const res = await saveConfigRow({ table, id: r.id, values })
      if (!res.ok) return showError(res.error)
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...values } : x)))
      setDrafts((d) => {
        const n = { ...d }
        delete n[r.id]
        return n
      })
      setSavedId(r.id)
      setTimeout(() => setSavedId(null), 1200)
      router.refresh()
    })

  const move = (index: number, dir: -1 | 1) => {
    const next = [...rows]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setRows(next)
    start(async () => {
      const res = await reorderConfigRows(table, next.map((r) => r.id))
      if (!res.ok) showError(res.error)
      else router.refresh()
    })
  }

  const create = () =>
    start(async () => {
      if (!adding) return
      const res = await saveConfigRow({
        table,
        values: { ...fixed, ...adding, active: true, sort_order: rows.length + 1 },
      })
      if (!res.ok) return showError(res.error)
      toast.success(t("added"))
      setAdding(null)
      router.refresh()
      setRows((prev) => [...prev, { ...fixed, ...adding, id: res.data.id, active: true, sort_order: prev.length + 1 } as Row])
    })

  const renderInput = (c: ConfigColumn, val: string, onChange: (v: string) => void, disabled = false) =>
    c.type === "select" ? (
      <NativeSelect value={val} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8">
        <option value="">—</option>
        {c.options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </NativeSelect>
    ) : c.type === "color" ? (
      <input type="color" value={val || "#2a8a9b"} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8 w-12 cursor-pointer rounded border" aria-label={c.label} />
    ) : (
      <Input value={val} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cn("h-8", c.type === "code" && "font-mono text-xs")} dir={c.dir} aria-label={c.label} />
    )

  return (
    <div className="space-y-3">
      <div className="scroll-x rounded-xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-16 px-2 py-2 text-start font-medium">{t("order")}</th>
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-2 text-start font-medium" style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className="w-20 px-2 py-2 text-start font-medium">{t("active")}</th>
              <th className="w-24 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={cn("border-t", !r.active && "opacity-60")}>
                <td className="px-2 py-1.5">
                  <div className="flex">
                    <Button size="icon-xs" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0 || pending} aria-label={t("moveUp")}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon-xs" variant="ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1 || pending} aria-label={t("moveDown")}>
                      <ArrowDown />
                    </Button>
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="px-2 py-1.5">
                    {renderInput(c, value(r, c.key), (v) => setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], [c.key]: v } })), c.immutable)}
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <Switch checked={r.active} onCheckedChange={(v) => saveRow(r, { active: v })} aria-label={t("active")} />
                </td>
                <td className="px-2 py-1.5 text-end">
                  <AnimatePresence mode="wait">
                    {savedId === r.id ? (
                      <motion.span key="ok" initial={{ scale: 0.6 }} animate={{ scale: 1 }} className="inline-flex text-success">
                        <Check className="size-4" />
                      </motion.span>
                    ) : dirty(r.id) ? (
                      <Button key="save" size="sm" onClick={() => saveRow(r)} disabled={pending}>
                        {pending ? <Loader2 className="animate-spin" /> : t("save")}
                      </Button>
                    ) : null}
                  </AnimatePresence>
                </td>
              </tr>
            ))}
            {adding && (
              <tr className="border-t bg-primary/5">
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{t("new")}</td>
                {columns.map((c) => (
                  <td key={c.key} className="px-2 py-1.5">
                    {renderInput(c, (adding[c.key] ?? "") as string, (v) => setAdding((a) => ({ ...a, [c.key]: v })))}
                  </td>
                ))}
                <td />
                <td className="px-2 py-1.5 text-end">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                      {t("cancel")}
                    </Button>
                    <Button size="sm" onClick={create} disabled={pending}>
                      {pending ? <Loader2 className="animate-spin" /> : t("add")}
                    </Button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!adding && (
        <Button size="sm" variant="outline" onClick={() => setAdding({})}>
          <Plus />
          {t("addRow")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t("noDeleteHint")}</p>
    </div>
  )
}
