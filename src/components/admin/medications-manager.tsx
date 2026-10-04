"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, Pencil, Pill, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { saveMedication } from "@/lib/actions/prescriptions"
import { cn } from "@/lib/utils"
import type { Medication } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

const FIELDS = [
  ["name_en", "ltr"],
  ["name_ar", "rtl"],
  ["generic_name", "ltr"],
  ["brand_name", "ltr"],
  ["strength", "ltr"],
  ["form", "auto"],
  ["route", "auto"],
  ["default_dose", "auto"],
  ["default_frequency", "auto"],
  ["default_duration", "auto"],
  ["default_instructions", "auto"],
] as const
type Key = (typeof FIELDS)[number][0]

/** Medication catalog — the only source of prescription suggestions. */
export function MedicationsManager({ medications }: { medications: Medication[] }) {
  const t = useTranslations("medications")
  const router = useRouter()
  const { showError } = useActionError()
  const [q, setQ] = useState("")
  const [editing, setEditing] = useState<(Partial<Record<Key, string | null>> & { id?: string; active: boolean }) | null>(null)
  const [pending, start] = useSafeTransition()
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? medications.filter((m) => `${m.name_en} ${m.name_ar ?? ""} ${m.generic_name ?? ""} ${m.brand_name ?? ""}`.toLowerCase().includes(s)) : medications
  }, [medications, q])

  const save = () =>
    start(async () => {
      if (!editing) return
      const res = await saveMedication({ ...editing, name_en: editing.name_en ?? "" } as never)
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      setEditing(null)
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-8" />
        </div>
        <Button className="ms-auto" onClick={() => setEditing({ active: true })}>
          <Plus />
          {t("add")}
        </Button>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={Pill} title={t("empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("fields.name_en")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("fields.strength")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("fields.form")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("defaults")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("uses")}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((m) => (
                <tr key={m.id} className={cn("hover:bg-muted/40", !m.active && "opacity-50")}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{m.name_en}</p>
                    <p className="text-xs text-muted-foreground">{[m.name_ar, m.generic_name, m.brand_name].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-2">{m.strength}</td>
                  <td className="px-3 py-2">{m.form}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground" dir="auto">
                    {[m.default_dose, m.default_frequency, m.default_duration].filter(Boolean).join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{m.use_count}</td>
                  <td className="px-1 py-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("edit")}
                      onClick={() =>
                        setEditing({
                          id: m.id,
                          active: m.active,
                          ...Object.fromEntries(FIELDS.map(([k]) => [k, m[k] ?? ""])),
                        })
                      }
                    >
                      <Pencil />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("edit") : t("add")}</DialogTitle>
            <DialogDescription>{t("hint")}</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map(([k, dir]) => (
                <div key={k} className={cn("grid gap-1", k === "default_instructions" && "sm:col-span-2")}>
                  <Label htmlFor={`md-${k}`}>{t(`fields.${k}`)}</Label>
                  <Input id={`md-${k}`} dir={dir} value={editing[k] ?? ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.active} onCheckedChange={(c) => setEditing({ ...editing, active: c })} />
                {t("active")}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending || !editing?.name_en?.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
