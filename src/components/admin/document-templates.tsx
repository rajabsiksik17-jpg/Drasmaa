"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Archive, FileText, Loader2, RectangleHorizontal, RectangleVertical } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { saveDocumentRetention, saveDocumentTemplate } from "@/lib/actions/templates"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface DocumentTemplateRow {
  document_type: string
  name_en: string
  name_ar: string
  orientation: "portrait" | "landscape"
  margin_top_mm: number
  margin_right_mm: number
  margin_bottom_mm: number
  margin_left_mm: number
  show_logo: boolean
  show_header: boolean
  show_patient_block: boolean
  show_footer: boolean
  show_doctor_info: boolean
  show_signature: boolean
  footer_text_en: string | null
  footer_text_ar: string | null
  version: number
}

export function DocumentTemplatesEditor({ templates, retentionDays, canRetention }: { templates: DocumentTemplateRow[]; retentionDays: number | null; canRetention: boolean }) {
  const t = useTranslations("docTemplates")
  const td = useTranslations("documentTypes")
  const [selected, setSelected] = useState(templates[0]?.document_type ?? "")
  const current = templates.find((x) => x.document_type === selected)
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        <ul className="space-y-1">
          {templates.map((tp) => (
            <li key={tp.document_type}>
              <button
                type="button"
                onClick={() => setSelected(tp.document_type)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm transition",
                  selected === tp.document_type ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                )}
              >
                {tp.orientation === "landscape" ? <RectangleHorizontal className="size-4" /> : <RectangleVertical className="size-4" />}
                {td(tp.document_type)}
              </button>
            </li>
          ))}
        </ul>
        {current && <TemplateForm key={`${current.document_type}-${current.version}`} template={current} />}
      </div>
      {canRetention && <RetentionCard initial={retentionDays} />}
      <p className="text-xs text-muted-foreground">{t("snapshotNote")}</p>
    </div>
  )
}

function TemplateForm({ template }: { template: DocumentTemplateRow }) {
  const t = useTranslations("docTemplates")
  const router = useRouter()
  const { showError } = useActionError()
  const [v, setV] = useState(template)
  const [pending, start] = useSafeTransition()
  const toggle = (k: keyof DocumentTemplateRow, label: string) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={v[k] as boolean} onCheckedChange={(c) => setV({ ...v, [k]: c })} />
    </label>
  )
  const margin = (k: "margin_top_mm" | "margin_right_mm" | "margin_bottom_mm" | "margin_left_mm") => (
    <div className="grid gap-1">
      <Label htmlFor={`dt-${k}`} className="text-xs">
        {t(`margins.${k}`)}
      </Label>
      <Input id={`dt-${k}`} type="number" min={0} max={40} dir="ltr" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
    </div>
  )
  const save = () =>
    start(async () => {
      const { version, ...rest } = v
      const res = await saveDocumentTemplate({ ...rest, expectedVersion: version })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  return (
    <SectionCard title={t("layout")} icon={FileText}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="dt-name-ar">{t("nameAr")}</Label>
            <Input id="dt-name-ar" dir="rtl" value={v.name_ar} onChange={(e) => setV({ ...v, name_ar: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dt-name-en">{t("nameEn")}</Label>
            <Input id="dt-name-en" dir="ltr" value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["portrait", "landscape"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setV({ ...v, orientation: o })}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                v.orientation === o ? "border-primary bg-primary/[0.06] text-primary" : "hover:bg-muted",
              )}
            >
              {o === "portrait" ? <RectangleVertical className="size-4" /> : <RectangleHorizontal className="size-4" />}
              {t(o)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {margin("margin_top_mm")}
          {margin("margin_right_mm")}
          {margin("margin_bottom_mm")}
          {margin("margin_left_mm")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {toggle("show_header", t("showHeader"))}
          {toggle("show_logo", t("showLogo"))}
          {toggle("show_patient_block", t("showPatient"))}
          {toggle("show_doctor_info", t("showDoctor"))}
          {toggle("show_signature", t("showSignature"))}
          {toggle("show_footer", t("showFooter"))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="dt-footer-ar">{t("footerAr")}</Label>
            <Input id="dt-footer-ar" dir="rtl" value={v.footer_text_ar ?? ""} onChange={(e) => setV({ ...v, footer_text_ar: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dt-footer-en">{t("footerEn")}</Label>
            <Input id="dt-footer-en" dir="ltr" value={v.footer_text_en ?? ""} onChange={(e) => setV({ ...v, footer_text_en: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("paperNote")}</p>
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {t("save")}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

function RetentionCard({ initial }: { initial: number | null }) {
  const t = useTranslations("docTemplates")
  const router = useRouter()
  const { showError } = useActionError()
  const [enabled, setEnabled] = useState(initial !== null)
  const [days, setDays] = useState(initial ?? 365)
  const [pending, start] = useSafeTransition()
  return (
    <SectionCard title={t("retention")} icon={Archive}>
      <p className="mb-3 text-sm text-muted-foreground">{t("retentionHint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          {t("retentionEnabled")}
        </label>
        {enabled && (
          <div className="grid gap-1">
            <Label htmlFor="dt-ret" className="text-xs">
              {t("retentionDays")}
            </Label>
            <Input id="dt-ret" type="number" min={1} max={36500} dir="ltr" className="w-32" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </div>
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveDocumentRetention(enabled ? days : null)
              if (!res.ok) return showError(res.error)
              toast.success(t("saved"))
              router.refresh()
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          {t("save")}
        </Button>
      </div>
    </SectionCard>
  )
}
