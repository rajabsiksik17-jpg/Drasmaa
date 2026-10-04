"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Camera, CheckCircle2, FileUp, Loader2, RotateCcw, UploadCloud, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/common/native-select"
import { DateInput } from "@/components/common/date-input"
import { useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { ACCEPT_ATTRIBUTE, checkFile, fileExtension, formatBytes } from "@/lib/storage/files"
import { uploadDocument, type UploadLinks } from "@/lib/storage/upload-client"
import { cn } from "@/lib/utils"
import { DOCUMENT_CATEGORIES as ALL_CATEGORIES, type DocumentCategory } from "@/types/db"

export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = ALL_CATEGORIES

type Item = {
  key: string
  file: File
  title: string
  category: DocumentCategory
  progress: number
  state: "ready" | "uploading" | "done" | "failed"
  error?: string
}

const guessCategory = (file: File, fallback: DocumentCategory): DocumentCategory => {
  const n = file.name.toLowerCase()
  if (/(us|ultra|sono|echo|سونار)/.test(n)) return "ultrasound"
  if (/(lab|cbc|hormone|amh|tsh|semen|تحليل)/.test(n)) return "lab"
  if (/(hsg|mri|ct|xray|x-ray)/.test(n)) return "imaging"
  if (/(referral|تحويل)/.test(n)) return "referral"
  if (/(passport|id|هوية|جواز)/.test(n)) return "identity"
  return fallback
}

/**
 * Attachments: several files at once (drag & drop, picker, phone camera /
 * gallery), each with its own display name, category and progress bar.
 * Classification is metadata only — any configured safe type can be
 * attached to the patient, a visit, a case or an investigation.
 */
export function UploadDialog({
  open,
  onOpenChange,
  links,
  defaultCategory = "medical",
  lockCategory = false,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  links: UploadLinks
  defaultCategory?: DocumentCategory
  lockCategory?: boolean
  onUploaded?: (documentId: string) => void
}) {
  const t = useTranslations("documents")
  const tc = useTranslations("common")
  const refs = useRefs()
  const router = useRouter()
  const { message } = useActionError()
  const [items, setItems] = useState<Item[]>([])
  const [notes, setNotes] = useState("")
  const [date, setDate] = useState<string | null>(null)
  const [tags, setTags] = useState("")
  const [level, setLevel] = useState<"visit" | "patient">(links.visitId ? "visit" : "patient")
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const aborts = useRef(new Map<string, AbortController>())
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  const add = (files: FileList | File[] | null | undefined) => {
    if (!files) return
    const next: Item[] = []
    for (const f of Array.from(files).slice(0, 20)) {
      const check = checkFile(f, refs.settings.max_upload_mb)
      if (!check.ok) {
        toast.error(`${f.name}: ${t(check.code, { max: refs.settings.max_upload_mb })}`)
        continue
      }
      const base = f.name.slice(0, f.name.length - fileExtension(f.name).length - 1) || f.name
      next.push({ key: crypto.randomUUID(), file: f, title: base.slice(0, 200), category: lockCategory ? defaultCategory : guessCategory(f, defaultCategory), progress: 0, state: "ready" })
    }
    setItems((list) => [...list, ...next])
    if (inputRef.current) inputRef.current.value = ""
    if (cameraRef.current) cameraRef.current.value = ""
  }

  const uploadOne = async (item: Item) => {
    const abort = new AbortController()
    aborts.current.set(item.key, abort)
    patch(item.key, { state: "uploading", progress: 0, error: undefined })
    try {
      const res = await uploadDocument(
        item.file,
        {
          ...links,
          visitId: level === "visit" ? (links.visitId ?? null) : null,
          category: item.category,
          title: item.title.trim() || null,
          notes: notes.trim() || null,
          documentDate: date,
          tags: tags
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 20),
        },
        (p) => patch(item.key, { progress: p }),
        abort.signal,
      )
      if (!res.ok) return patch(item.key, { state: "failed", error: abort.signal.aborted ? t("cancelled") : message(res.error, "uploadDocument") })
      patch(item.key, { state: "done", progress: 1 })
      onUploaded?.(res.id)
    } catch (error) {
      console.error("[upload] failed", error)
      patch(item.key, { state: "failed", error: message({ code: typeof navigator !== "undefined" && !navigator.onLine ? "network" : "unexpected" }, "uploadDocument") })
    } finally {
      aborts.current.delete(item.key)
    }
  }

  const uploadAll = async () => {
    setBusy(true)
    // Two at a time: fast on Wi-Fi, still gentle on mobile data.
    const queue = items.filter((i) => i.state === "ready" || i.state === "failed")
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length) await uploadOne(queue.shift()!)
    })
    await Promise.all(workers)
    setBusy(false)
    router.refresh()
  }

  const done = items.length > 0 && items.every((i) => i.state === "done")
  const close = (o: boolean) => {
    if (!o) {
      for (const a of aborts.current.values()) a.abort()
      if (items.some((i) => i.state === "done")) toast.success(t("uploadedCount", { count: items.filter((i) => i.state === "done").length }))
      setItems([])
      setNotes("")
      setTags("")
      setDate(null)
    }
    onOpenChange(o)
  }

  const pending = items.filter((i) => i.state === "ready" || i.state === "failed").length

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:grid-rows-[auto_1fr_auto] max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="size-5 text-primary" />
            {t("uploadTitle")}
          </DialogTitle>
          <DialogDescription>{t("uploadHintMulti", { max: refs.settings.max_upload_mb })}</DialogDescription>
        </DialogHeader>

        <div className="grid content-start gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              add(e.dataTransfer.files)
            }}
            className={cn("rounded-xl border-2 border-dashed p-5 text-center transition", dragging ? "border-primary bg-primary/5" : "border-border")}
          >
            <UploadCloud className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 text-sm">{t("dropHere")}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                <FileUp />
                {t("chooseFiles")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => cameraRef.current?.click()} className="sm:hidden">
                <Camera />
                {t("camera")}
              </Button>
            </div>
            <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} hidden onChange={(e) => add(e.target.files)} />
            <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => add(e.target.files)} />
          </div>

          {items.length > 0 && (
            <ul className="space-y-2" aria-live="polite">
              {items.map((it) => (
                <li key={it.key} className={cn("rounded-lg border p-2.5 text-sm", it.state === "failed" && "border-destructive/40 bg-destructive/5")}>
                  <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_11rem_auto] sm:items-center">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <Input
                        value={it.title}
                        onChange={(e) => patch(it.key, { title: e.target.value })}
                        disabled={it.state === "uploading" || it.state === "done"}
                        aria-label={t("displayName")}
                        placeholder={t("displayName")}
                        dir="auto"
                        className="h-8"
                      />
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="ltr">
                        {it.file.name} · {formatBytes(it.file.size)}
                      </p>
                    </div>
                    <NativeSelect
                      value={it.category}
                      disabled={lockCategory || it.state === "uploading" || it.state === "done"}
                      onChange={(e) => patch(it.key, { category: e.target.value as DocumentCategory })}
                      aria-label={t("category")}
                      className="h-8"
                    >
                      {DOCUMENT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {t(`categories.${c}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    <div className="flex items-center justify-end gap-1">
                      {it.state === "done" && <CheckCircle2 className="size-5 text-success" aria-label={t("uploaded")} />}
                      {it.state === "uploading" && (
                        <Button size="icon-sm" variant="ghost" aria-label={tc("cancel")} onClick={() => aborts.current.get(it.key)?.abort()}>
                          <X />
                        </Button>
                      )}
                      {it.state === "failed" && (
                        <Button size="icon-sm" variant="ghost" aria-label={t("retry")} onClick={() => void uploadOne(it)}>
                          <RotateCcw />
                        </Button>
                      )}
                      {(it.state === "ready" || it.state === "failed") && (
                        <Button size="icon-sm" variant="ghost" aria-label={t("removeFile")} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                          <X />
                        </Button>
                      )}
                    </div>
                  </div>
                  {(it.state === "uploading" || it.state === "done") && <Progress value={Math.round(it.progress * 100)} className="mt-2 h-1.5" />}
                  {it.error && <p className="mt-1 text-xs text-destructive">{it.error}</p>}
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {links.visitId && (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>{t("attachTo")}</Label>
                <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
                  {(["visit", "patient"] as const).map((l) => (
                    <button key={l} type="button" onClick={() => setLevel(l)} className={cn("rounded-md py-1.5", level === l ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
                      {t(`level.${l}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="up-date">{t("documentDate")}</Label>
              <DateInput id="up-date" value={date} onChange={setDate} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="up-tags">{t("tags")}</Label>
              <Input id="up-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("tagsPlaceholder")} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="up-notes">{t("description")}</Label>
              <Textarea id="up-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter className="max-sm:sticky max-sm:bottom-0 max-sm:bg-background max-sm:py-3">
          <Button variant="outline" onClick={() => close(false)}>
            {done ? tc("close") : tc("cancel")}
          </Button>
          <Button onClick={() => void uploadAll()} disabled={busy || pending === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <UploadCloud />}
            {t("uploadCount", { count: pending })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
