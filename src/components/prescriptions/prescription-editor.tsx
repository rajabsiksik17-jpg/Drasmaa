"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Ban, CheckCircle2, Copy, Loader2, Pill, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ReasonDialog } from "@/components/forms/correction-context"
import { ExportMenu } from "@/components/documents/export-menu"
import { useCan, useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import {
  addPrescriptionItem,
  cancelPrescription,
  duplicatePrescription,
  ensureVisitPrescription,
  issuePrescription,
  removePrescriptionItem,
  savePrescriptionNotes,
  searchMedications,
  updatePrescriptionItem,
} from "@/lib/actions/prescriptions"
import { formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { Medication, Prescription, PrescriptionItem } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export type PrescriptionWithItems = Prescription & { items: PrescriptionItem[] }

const FIELDS = ["dose", "route", "frequency", "duration", "quantity", "instructions"] as const
type Field = (typeof FIELDS)[number]

/** Fast medication search: type → pick → the row is added with the catalog defaults. */
function MedicationSearch({ onPick, disabled }: { onPick: (m: Medication | string) => void; disabled?: boolean }) {
  const t = useTranslations("prescriptions")
  const locale = useLocale()
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Medication[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    if (!q.trim()) return
    const id = ++seq.current
    const handle = setTimeout(async () => {
      const res = await searchMedications(q)
      if (id === seq.current && res.ok) {
        setResults(res.data)
        setActive(0)
      }
    }, 150)
    return () => clearTimeout(handle)
  }, [q])

  const shown = q.trim() ? results : []
  const pick = (m: Medication | string) => {
    onPick(m)
    setQ("")
    setResults([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, shown.length))
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0))
          if (e.key === "Enter") {
            e.preventDefault()
            if (shown[active]) pick(shown[active])
            else if (q.trim()) pick(q.trim())
          }
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder={t("searchPlaceholder")}
        className="ps-8"
        role="combobox"
        aria-expanded={open && q.trim().length > 0}
        aria-autocomplete="list"
      />
      <AnimatePresence>
        {open && q.trim() && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
          >
            {shown.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                  className={cn("flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-start text-sm", i === active ? "bg-accent" : "hover:bg-accent/60")}
                >
                  <span className="font-medium">{m.name_en}</span>
                  {m.strength && <span className="text-xs">{m.strength}</span>}
                  {m.form && <span className="text-xs text-muted-foreground">{m.form}</span>}
                  {locale === "ar" && m.name_ar && <span className="ms-auto text-xs text-muted-foreground">{m.name_ar}</span>}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(q.trim())}
                className={cn("w-full rounded-md px-2 py-1.5 text-start text-sm text-muted-foreground", active === shown.length ? "bg-accent" : "hover:bg-accent/60")}
              >
                <Plus className="me-1 inline size-3.5" />
                {t("freeText", { name: q.trim() })}
              </button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

function ItemRow({ item, editable, onRemoved }: { item: PrescriptionItem; editable: boolean; onRemoved: () => void }) {
  const t = useTranslations("prescriptions")
  const { showError } = useActionError()
  const [values, setValues] = useState<Record<Field, string>>(() => Object.fromEntries(FIELDS.map((f) => [f, item[f] ?? ""])) as Record<Field, string>)
  const saved = useRef(values)
  const save = async (field: Field) => {
    if (values[field] === saved.current[field]) return
    const res = await updatePrescriptionItem({ id: item.id, [field]: values[field] || null })
    if (!res.ok) return showError(res.error)
    saved.current = { ...saved.current, [field]: values[field] }
  }
  const list = (f: Field) => (f === "frequency" ? "rx-frequency" : f === "route" ? "rx-route" : f === "duration" ? "rx-duration" : undefined)
  return (
    <tr className="align-top">
      <td className="px-2 py-1.5">
        <p className="font-medium">{item.medication_name}</p>
        {(item.strength || item.form) && <p className="text-xs text-muted-foreground">{[item.strength, item.form].filter(Boolean).join(" · ")}</p>}
      </td>
      {FIELDS.map((f) => (
        <td key={f} className={cn("px-1 py-1", f === "instructions" && "min-w-40")}>
          {editable ? (
            <Input
              value={values[f]}
              list={list(f)}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              onBlur={() => void save(f)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label={t(`fields.${f}`)}
              className="h-8 text-sm"
              dir="auto"
            />
          ) : (
            <span className="text-sm">{values[f] || "—"}</span>
          )}
        </td>
      ))}
      {editable && (
        <td className="px-1 py-1">
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-destructive"
            aria-label={t("remove")}
            onClick={async () => {
              const res = await removePrescriptionItem(item.id)
              if (!res.ok) return showError(res.error)
              onRemoved()
            }}
          >
            <Trash2 />
          </Button>
        </td>
      )}
    </tr>
  )
}

/**
 * Prescriptions of a visit (or of the patient). The draft is edited
 * directly in the table; issuing (or completing the visit) fixes it.
 * Issued prescriptions are never edited — cancel (with reason) or copy.
 */
export function PrescriptionEditor({
  patientId,
  visitId,
  prescriptions,
  visitOpen,
}: {
  patientId: string
  visitId: string | null
  prescriptions: PrescriptionWithItems[]
  visitOpen: boolean
}) {
  const t = useTranslations("prescriptions")
  const locale = useLocale()
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [cancelling, setCancelling] = useState<string | null>(null)
  const canWrite = can(P.prescriptionsCreate)
  const draft = prescriptions.find((p) => p.status === "draft")
  const [notes, setNotes] = useState(draft?.notes ?? "")

  const add = (m: Medication | string) =>
    start(async () => {
      let rxId = draft?.id
      if (!rxId) {
        if (!visitId) return
        const created = await ensureVisitPrescription(visitId)
        if (!created.ok) return showError(created.error)
        rxId = created.data.id
      }
      const item =
        typeof m === "string"
          ? { medication_name: m }
          : {
              medicationId: m.id,
              medication_name: [m.name_en, m.strength].filter(Boolean).join(" "),
              generic_name: m.generic_name,
              strength: m.strength,
              form: m.form,
              dose: m.default_dose,
              route: m.route,
              frequency: m.default_frequency,
              duration: m.default_duration,
              instructions: m.default_instructions,
            }
      const res = await addPrescriptionItem({ prescriptionId: rxId, ...item })
      if (!res.ok) return showError(res.error)
      router.refresh()
    })

  const issue = (id: string) =>
    start(async () => {
      const res = await issuePrescription(id)
      if (!res.ok) return showError(res.error)
      toast.success(t("issued"))
      router.refresh()
    })

  const copy = (id: string) =>
    start(async () => {
      const res = await duplicatePrescription(id, visitOpen ? visitId : null)
      if (!res.ok) return showError(res.error)
      toast.success(t("copied"))
      router.refresh()
    })

  const header = (
    <thead className="bg-muted/40 text-xs text-muted-foreground">
      <tr>
        <th className="px-2 py-1.5 text-start font-medium">{t("fields.medication")}</th>
        {FIELDS.map((f) => (
          <th key={f} className="px-1 py-1.5 text-start font-medium">
            {t(`fields.${f}`)}
          </th>
        ))}
      </tr>
    </thead>
  )

  return (
    <div className="space-y-4">
      <datalist id="rx-frequency">{refs.activeOptions("rx_frequency").map((o) => <option key={o.value} value={o.label} />)}</datalist>
      <datalist id="rx-route">{refs.activeOptions("rx_route").map((o) => <option key={o.value} value={o.label} />)}</datalist>
      <datalist id="rx-duration">{refs.activeOptions("rx_duration").map((o) => <option key={o.value} value={o.label} />)}</datalist>
      {canWrite && visitOpen && (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2">
            <Pill className="size-4 text-primary" />
            <p className="text-sm font-semibold">{draft ? draft.prescription_number : t("newPrescription")}</p>
            {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {draft && draft.items.length > 0 && (
              <div className="ms-auto flex gap-1.5">
                <ExportMenu target={{ type: "prescription", entityId: draft.id, patientId }} />
                <Button size="sm" onClick={() => issue(draft.id)} disabled={pending}>
                  <CheckCircle2 />
                  {t("issue")}
                </Button>
              </div>
            )}
          </div>
          <MedicationSearch onPick={add} disabled={pending} />
          {draft && draft.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                {header}
                <tbody className="divide-y">
                  {[...draft.items]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((it) => (
                      <ItemRow key={it.id} item={it} editable onRemoved={() => router.refresh()} />
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {draft && (
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={async () => {
                if (notes === (draft.notes ?? "")) return
                const res = await savePrescriptionNotes(draft.id, notes)
                if (!res.ok) showError(res.error)
              }}
              placeholder={t("notesPlaceholder")}
              className="min-h-14"
              dir="auto"
            />
          )}
          <p className="text-[11px] text-muted-foreground">{t("hint")}</p>
        </div>
      )}

      {prescriptions
        .filter((p) => p.status !== "draft" || !(canWrite && visitOpen))
        .map((p) => (
          <div key={p.id} className={cn("space-y-2 rounded-xl border bg-card p-3", p.status === "cancelled" && "opacity-60")}>
            <div className="flex flex-wrap items-center gap-2">
              <Pill className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{p.prescription_number}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  p.status === "issued" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : p.status === "cancelled" ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground",
                )}
              >
                {t(`status.${p.status}`)}
              </span>
              <span className="text-xs text-muted-foreground">{formatDateTime(p.issued_at ?? p.created_at, locale)}</span>
              <div className="ms-auto flex gap-1.5">
                {p.status !== "cancelled" && p.items.length > 0 && <ExportMenu target={{ type: "prescription", entityId: p.id, patientId }} />}
                {canWrite && p.items.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => copy(p.id)} disabled={pending}>
                    <Copy />
                    <span className="hidden sm:inline">{t("copy")}</span>
                  </Button>
                )}
                {p.status === "issued" && can(P.prescriptionsEdit) && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(p.id)}>
                    <Ban />
                    <span className="hidden sm:inline">{t("cancel")}</span>
                  </Button>
                )}
              </div>
            </div>
            {p.cancel_reason && <p className="text-xs text-destructive">{t("cancelledBecause", { reason: p.cancel_reason })}</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                {header}
                <tbody className="divide-y">
                  {[...p.items]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((it) => (
                      <ItemRow key={it.id} item={it} editable={false} onRemoved={() => {}} />
                    ))}
                </tbody>
              </table>
            </div>
            {p.notes && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{p.notes}</p>}
          </div>
        ))}

      {prescriptions.length === 0 && !(canWrite && visitOpen) && <p className="text-sm text-muted-foreground">{t("empty")}</p>}

      <ReasonDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        onConfirm={(reason) =>
          start(async () => {
            if (!cancelling) return
            const res = await cancelPrescription(cancelling, reason)
            setCancelling(null)
            if (!res.ok) return showError(res.error)
            toast.success(t("cancelled"))
            router.refresh()
          })
        }
      />
    </div>
  )
}
