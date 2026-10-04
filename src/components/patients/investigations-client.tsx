"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/common/native-select"
import { DateInput } from "@/components/common/date-input"
import { useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { addInvestigationResult } from "@/lib/actions/clinical"
import { clinicToday, formatDate } from "@/lib/dates"
import type { Investigation, InvestigationResult } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export function AddResultButton({ patientId }: { patientId: string }) {
  const t = useTranslations("investigations")
  const tc = useTranslations("common")
  const refs = useRefs()
  const router = useRouter()
  const { message } = useActionError()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState("")
  const [value, setValue] = useState("")
  const [date, setDate] = useState(clinicToday())
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useSafeTransition()
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        {t("addResult")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addResult")}</DialogTitle>
            <DialogDescription>{t("addResultHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="res-type">{t("test")}</Label>
              <NativeSelect id="res-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{tc("select")}</option>
                {refs.investigationTypes
                  .filter((x) => x.active)
                  .map((x) => (
                    <option key={x.code} value={x.code}>
                      {refs.pick(x.name_en, x.name_ar)}
                      {x.unit ? ` (${x.unit})` : ""}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="res-value">{t("result")}</Label>
                <Input id="res-value" value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="res-date">{t("date")}</Label>
                <DateInput id="res-date" max={clinicToday()} value={date || null} onChange={(v) => setDate(v ?? "")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="res-notes">{t("notes")}</Label>
              <Textarea id="res-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || !type || !value.trim()}
              onClick={() =>
                start(async () => {
                  const res = await addInvestigationResult({ patientId, typeCode: type, value, resultDate: date, notes })
                  if (!res.ok) return setError(message(res.error))
                  toast.success(t("resultAdded"))
                  setOpen(false)
                  setValue("")
                  setNotes("")
                  router.refresh()
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** History per test, newest first — every historical value is preserved. */
export function ResultsHistory({ rows, patientId }: { rows: InvestigationResult[]; patientId: string }) {
  const t = useTranslations("investigations")
  const refs = useRefs()
  const groups = (() => {
    const map = new Map<string, InvestigationResult[]>()
    for (const r of rows) map.set(r.type_code, [...(map.get(r.type_code) ?? []), r])
    const order = (code: string) => refs.investigationTypes.find((x) => x.code === code)?.sort_order ?? 999
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]))
  })()
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map(([code, list]) => {
        const type = refs.investigationTypes.find((x) => x.code === code)
        return (
          <div key={code} className="rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
              <span className="text-sm font-semibold">{refs.investigationName(code)}</span>
              {type?.unit && <span className="text-xs text-muted-foreground">{type.unit}</span>}
            </div>
            <ul className="divide-y text-sm">
              {list.slice(0, 6).map((r, i) => (
                <li key={r.id} className="flex items-center justify-between px-3 py-1.5">
                  <span className={i === 0 ? "font-semibold tabular-nums" : "tabular-nums text-muted-foreground"}>{r.value_numeric ?? r.value_text}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(r.result_date)}
                    {r.visit_id && (
                      <>
                        {" · "}
                        <Link href={`/patients/${patientId}/visits/${r.visit_id}`} className="text-primary hover:underline">
                          {t("visit")}
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

export function RequestedList({ rows, patientId }: { rows: Investigation[]; patientId: string }) {
  const t = useTranslations("investigations")
  const refs = useRefs()
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("noneRequested")}</p>
  return (
    <ul className="divide-y text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 py-2">
          <span className="font-medium">{refs.investigationName(r.type_code)}</span>
          <span className="text-xs text-muted-foreground">
            {t(`status.${r.status}`)} · {formatDate(r.performed_on ?? r.requested_on)}
            {r.visit_id && (
              <>
                {" · "}
                <Link href={`/patients/${patientId}/visits/${r.visit_id}`} className="text-primary hover:underline">
                  {t("visit")}
                </Link>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
