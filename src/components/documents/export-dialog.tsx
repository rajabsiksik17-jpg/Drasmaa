"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { CheckCircle2, Download, Eye, EyeOff, FileText, Loader2, Mail, MessageCircle, Printer, RefreshCw, Share2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useCan, useRefs } from "@/components/app-context"
import { MessageComposer, type ComposerChannel } from "@/components/messaging/message-composer"
import { useActionError } from "@/hooks/use-action-error"
import {
  documentPreviewUrl,
  generateDocument,
  listInvestigationCodes,
  logDocumentShare,
  type GeneratedDocument,
} from "@/lib/actions/generated-documents"
import { DOCUMENTS, SUMMARY_SECTIONS, type DocumentType } from "@/lib/documents/registry"
import { formatBytes } from "@/lib/storage/files"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export type ExportIntent = "pdf" | "whatsapp" | "email"

export interface ExportTarget {
  type: DocumentType
  entityId: string
  /** null only for standalone medical reports. */
  patientId: string | null
}

const canNativeShare = () =>
  typeof navigator !== "undefined" && typeof navigator.canShare === "function" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

/**
 * SELECT DATA → PREVIEW → GENERATE → SAVE → DOWNLOAD / PRINT / WHATSAPP / EMAIL.
 * Every generation creates a new immutable PDF snapshot in private storage.
 */
export function ExportDialog({
  open,
  onOpenChange,
  target,
  intent = "pdf",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ExportTarget
  intent?: ExportIntent
}) {
  const t = useTranslations("export")
  const td = useTranslations("documentTypes")
  const ts = useTranslations("reports.sections")
  const locale = useLocale()
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const { message } = useActionError()
  const [language, setLanguage] = useState<"ar" | "en">(locale === "ar" ? "ar" : "en")
  const sectionOptions = SUMMARY_SECTIONS.filter((s) => can(s.permission))
  const [sections, setSections] = useState<string[]>(() => sectionOptions.filter((s) => s.default).map((s) => s.key))
  const [codes, setCodes] = useState<{ code: string; count: number }[] | null>(null)
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [doc, setDoc] = useState<GeneratedDocument | null>(null)
  const [composer, setComposer] = useState<ComposerChannel | null>(null)
  const [generating, startGenerate] = useSafeTransition()
  const [previewing, startPreview] = useSafeTransition()

  useEffect(() => {
    if (!open || target.type !== "investigations" || !target.patientId) return
    void listInvestigationCodes(target.patientId).then((res) => {
      if (!res.ok) return
      setCodes(res.data)
      setSelectedCodes(res.data.map((c) => c.code))
    })
  }, [open, target.type, target.patientId])

  const input = () => ({
    type: target.type,
    entityId: target.entityId,
    language,
    sections: target.type === "patient_summary" ? sections : undefined,
    codes: target.type === "investigations" && codes && selectedCodes.length !== codes.length ? selectedCodes : undefined,
  })

  const refreshPreview = () =>
    startPreview(async () => {
      const res = await documentPreviewUrl(input())
      if (res.ok) setPreviewUrl(`${res.data.url}&t=${Date.now()}`)
      else toast.error(message(res.error))
    })

  // Preview follows the chosen options.
  useEffect(() => {
    if (!open || doc) return
    const id = setTimeout(refreshPreview, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, language, sections.join(","), selectedCodes.join(","), doc])

  const generate = () =>
    startGenerate(async () => {
      const res = await generateDocument(input())
      if (!res.ok) return void toast.error(message(res.error))
      setDoc(res.data)
      toast.success(t("generated"))
      router.refresh()
      if (intent === "whatsapp" || intent === "email") setComposer(intent)
    })

  const downloadHref = doc ? `/api/generated-documents/${doc.id}?download=1` : "#"
  const viewHref = doc ? `/api/generated-documents/${doc.id}` : "#"
  const printHref = `${DOCUMENTS[target.type].route(target.entityId)}?autoprint=1`

  const nativeShare = async () => {
    if (!doc) return
    try {
      const blob = await (await fetch(viewHref)).blob()
      const file = new File([blob], doc.file_name, { type: "application/pdf" })
      if (!navigator.canShare?.({ files: [file] })) return void toast.error(t("shareUnsupported"))
      await navigator.share({ files: [file], title: doc.file_name })
      await logDocumentShare(doc.id, "shared_native")
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(t("shareUnsupported"))
    }
  }

  const toggle = (list: string[], key: string, on: boolean) => (on ? [...new Set([...list, key])] : list.filter((k) => k !== key))

  return (
    <>
      <Dialog open={open && !composer} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              {td(target.type)}
            </DialogTitle>
            <DialogDescription>{doc ? t("readyHint") : t("hint")}</DialogDescription>
          </DialogHeader>

          <AnimatePresence mode="wait" initial={false}>
            {!doc ? (
              <motion.div key="options" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-5 lg:grid-cols-[18rem_1fr]">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>{t("language")}</Label>
                    <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
                      {(["ar", "en"] as const).map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setLanguage(l)}
                          className={cn("rounded-md py-1.5 text-sm font-medium", language === l ? "bg-background shadow-sm" : "text-muted-foreground")}
                        >
                          {l === "ar" ? "العربية" : "English"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("orientation", { value: t(DOCUMENTS[target.type].orientation) })}
                  </p>

                  {target.type === "patient_summary" && (
                    <fieldset className="space-y-2">
                      <legend className="mb-1 text-sm font-medium">{t("sections")}</legend>
                      {sectionOptions.map((s) => (
                        <label key={s.key} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={sections.includes(s.key)} onCheckedChange={(c) => setSections((prev) => toggle(prev, s.key, c === true))} />
                          {ts(s.key)}
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {target.type === "investigations" && (
                    <fieldset className="space-y-2">
                      <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
                        {t("tests")}
                        {codes && codes.length > 0 && (
                          <button
                            type="button"
                            className="text-xs font-normal text-primary"
                            onClick={() => setSelectedCodes(selectedCodes.length === codes.length ? [] : codes.map((c) => c.code))}
                          >
                            {selectedCodes.length === codes.length ? t("selectNone") : t("selectAll")}
                          </button>
                        )}
                      </legend>
                      {codes === null ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : codes.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("noResults")}</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {codes.map((c) => (
                            <label key={c.code} className="flex items-center gap-2 text-sm">
                              <Checkbox checked={selectedCodes.includes(c.code)} onCheckedChange={(v) => setSelectedCodes((prev) => toggle(prev, c.code, v === true))} />
                              <span className="truncate">{refs.investigationName(c.code)}</span>
                              <span className="text-[11px] text-muted-foreground">({c.count})</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </fieldset>
                  )}

                  <Button
                    className="w-full"
                    onClick={generate}
                    disabled={generating || (target.type === "patient_summary" && sections.length === 0) || (target.type === "investigations" && selectedCodes.length === 0)}
                  >
                    {generating ? <Loader2 className="animate-spin" /> : <FileText />}
                    {generating ? t("generating") : t("generate")}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">{t("snapshotNote")}</p>
                </div>

                <div className="min-w-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t("preview")}</p>
                    <div className="flex gap-1">
                      <Button size="xs" variant="ghost" onClick={refreshPreview} disabled={previewing}>
                        <RefreshCw className={cn(previewing && "animate-spin")} />
                        {t("refresh")}
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setShowPreview((v) => !v)}>
                        {showPreview ? <EyeOff /> : <Eye />}
                        {showPreview ? t("hidePreview") : t("showPreview")}
                      </Button>
                    </div>
                  </div>
                  {showPreview && (
                    <div className="overflow-hidden rounded-lg border bg-muted/30">
                      {previewUrl ? (
                        <iframe src={previewUrl} title={t("preview")} className="h-[62dvh] w-full bg-white" sandbox="allow-same-origin allow-scripts" />
                      ) : (
                        <div className="grid h-[62dvh] place-items-center">
                          <Loader2 className="size-6 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold break-all" dir="auto">
                      {doc.file_name}
                    </p>
                    <p className="text-muted-foreground">
                      {formatBytes(doc.size_bytes)} · {doc.language === "ar" ? "العربية" : "English"} · {t("version", { n: doc.version_no })}
                    </p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Button asChild variant="outline">
                    <a href={downloadHref}>
                      <Download />
                      {t("download")}
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={viewHref} target="_blank" rel="noopener">
                      <Eye />
                      {t("openPdf")}
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={printHref} target="_blank" rel="noopener" onClick={() => void logDocumentShare(doc.id, "printed")}>
                      <Printer />
                      {t("print")}
                    </a>
                  </Button>
                  {can(P.documentsShare, P.messagesPrepareWhatsapp) && (
                    <Button className="bg-[#128C7E] text-white hover:bg-[#0f7a6e]" onClick={() => setComposer("whatsapp")}>
                      <MessageCircle />
                      {t("whatsapp")}
                    </Button>
                  )}
                  {can(P.documentsShare) && can(P.messagesSendEmail) && (
                    <Button variant="secondary" onClick={() => setComposer("email")}>
                      <Mail />
                      {t("email")}
                    </Button>
                  )}
                  {canNativeShare() && (
                    <Button variant="secondary" onClick={() => void nativeShare()}>
                      <Share2 />
                      {t("share")}
                    </Button>
                  )}
                </div>
                <div className="flex justify-between gap-2 border-t pt-3">
                  <Button variant="ghost" onClick={() => setDoc(null)}>
                    {t("generateAnother")}
                  </Button>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    {t("close")}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>

      {composer && doc && (
        <MessageComposer
          open
          onOpenChange={(o) => !o && setComposer(null)}
          patientId={target.patientId}
          generatedDocumentId={doc.id}
          channel={composer}
          purpose="document_share"
        />
      )}
    </>
  )
}
