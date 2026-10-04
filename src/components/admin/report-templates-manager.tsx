"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { FileSignature, Loader2, Lock, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { NativeSelect } from "@/components/common/native-select"
import { REPORT_TYPES } from "@/components/reports/reports-list"
import { useActionError } from "@/hooks/use-action-error"
import { saveReportTemplate } from "@/lib/actions/reports"
import { cn } from "@/lib/utils"
import type { ReportTemplate } from "@/types/db"
import { useSafeTransition } from "@/hooks/use-safe-transition"

type Draft = Omit<ReportTemplate, "id" | "code" | "is_system" | "sort_order" | "version" | "created_at" | "updated_at" | "created_by" | "updated_by"> & { id?: string }

const empty = (): Draft => ({
  report_type: "custom",
  name_en: "",
  name_ar: "",
  title_en: "",
  title_ar: "",
  recipient_en: "To whom it may concern,",
  recipient_ar: "إلى من يهمه الأمر،",
  body_en: "",
  body_ar: "",
  active: true,
})

/** Reusable report templates (variables are filled when a report is created). */
export function ReportTemplatesManager({ templates }: { templates: ReportTemplate[] }) {
  const t = useTranslations("reportTemplates")
  const tr = useTranslations("medicalReports")
  const locale = useLocale()
  const router = useRouter()
  const { showError } = useActionError()
  const [editing, setEditing] = useState<Draft | null>(null)
  const [pending, start] = useSafeTransition()
  const save = () =>
    start(async () => {
      if (!editing) return
      const res = await saveReportTemplate({
        ...editing,
        report_type: editing.report_type as (typeof REPORT_TYPES)[number],
        title_en: editing.title_en || null,
        title_ar: editing.title_ar || null,
        recipient_en: editing.recipient_en || null,
        recipient_ar: editing.recipient_ar || null,
      })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      setEditing(null)
      router.refresh()
    })
  const field = (k: keyof Draft, label: string, dir: "ltr" | "rtl", area = false) => (
    <div className={cn("grid gap-1", area && "sm:col-span-2")}>
      <Label htmlFor={`rt-${k}`}>{label}</Label>
      {area ? (
        <Textarea id={`rt-${k}`} dir={dir} value={(editing?.[k] as string) ?? ""} onChange={(e) => setEditing({ ...editing!, [k]: e.target.value })} className="min-h-48 leading-7" />
      ) : (
        <Input id={`rt-${k}`} dir={dir} value={(editing?.[k] as string) ?? ""} onChange={(e) => setEditing({ ...editing!, [k]: e.target.value })} />
      )}
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(empty())}>
          <Plus />
          {t("new")}
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((tp) => (
          <li key={tp.id}>
            <button
              type="button"
              onClick={() => setEditing({ ...tp, title_en: tp.title_en ?? "", title_ar: tp.title_ar ?? "", recipient_en: tp.recipient_en ?? "", recipient_ar: tp.recipient_ar ?? "" })}
              className={cn("flex w-full flex-col gap-1 rounded-xl border bg-card p-4 text-start shadow-xs transition hover:border-primary", !tp.active && "opacity-60")}
            >
              <span className="flex items-center gap-2 font-medium">
                <FileSignature className="size-4 text-primary" />
                {locale === "ar" ? tp.name_ar : tp.name_en}
                {tp.is_system && <Lock className="size-3 text-muted-foreground" />}
              </span>
              <span className="text-xs text-muted-foreground">{tr(`types.${tp.report_type}`)}</span>
              <span className="line-clamp-3 text-xs whitespace-pre-line text-muted-foreground" dir="auto">
                {locale === "ar" ? tp.body_ar : tp.body_en}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <Sheet open onOpenChange={(o) => !o && setEditing(null)}>
          <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-3xl">
            <SheetHeader>
              <SheetTitle>{editing.id ? (locale === "ar" ? editing.name_ar : editing.name_en) : t("new")}</SheetTitle>
              <SheetDescription>{t("variablesHint")}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-3 px-4 pb-6 sm:grid-cols-2">
              {field("name_ar", t("nameAr"), "rtl")}
              {field("name_en", t("nameEn"), "ltr")}
              <div className="grid gap-1">
                <Label htmlFor="rt-type">{t("type")}</Label>
                <NativeSelect id="rt-type" value={editing.report_type} onChange={(e) => setEditing({ ...editing, report_type: e.target.value })}>
                  {REPORT_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {tr(`types.${x}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Switch checked={editing.active} onCheckedChange={(c) => setEditing({ ...editing, active: c })} />
                {t("active")}
              </label>
              {field("title_ar", t("titleAr"), "rtl")}
              {field("title_en", t("titleEn"), "ltr")}
              {field("recipient_ar", t("recipientAr"), "rtl")}
              {field("recipient_en", t("recipientEn"), "ltr")}
              {field("body_ar", t("bodyAr"), "rtl", true)}
              {field("body_en", t("bodyEn"), "ltr", true)}
              <div className="flex justify-end gap-2 border-t pt-4 sm:col-span-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </Button>
                <Button onClick={save} disabled={pending || !editing.name_en.trim() || !editing.name_ar.trim()}>
                  {pending && <Loader2 className="animate-spin" />}
                  {t("save")}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
