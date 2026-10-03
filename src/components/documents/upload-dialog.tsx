"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { CheckCircle2, FileUp, Loader2, UploadCloud, X } from "lucide-react"
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
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/common/native-select"
import { useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { ACCEPT_ATTRIBUTE, checkFile, formatBytes } from "@/lib/storage/files"
import { uploadDocument, type UploadLinks } from "@/lib/storage/upload-client"
import { cn } from "@/lib/utils"
import type { DocumentCategory } from "@/types/db"

export const DOCUMENT_CATEGORIES: DocumentCategory[] = ["sfa", "ivf_consent", "investigation", "ultrasound", "medical", "other"]

/** Validated, private upload with a real progress bar. */
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
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setTitle("")
    setNotes("")
    setProgress(null)
    setError(null)
    setCategory(defaultCategory)
  }

  const pick = (f: File | undefined | null) => {
    if (!f) return
    const check = checkFile(f, refs.settings.max_upload_mb)
    if (!check.ok) {
      setError(t(check.code, { max: refs.settings.max_upload_mb }))
      setFile(null)
      return
    }
    setError(null)
    setFile(f)
  }

  const submit = async () => {
    if (!file) return
    abort.current = new AbortController()
    setProgress(0)
    setError(null)
    const res = await uploadDocument(file, { ...links, category, title: title || null, notes: notes || null }, setProgress, abort.current.signal)
    if (!res.ok) {
      setProgress(null)
      setError(message(res.error))
      return
    }
    toast.success(t("uploaded", { name: file.name }))
    onUploaded?.(res.id)
    router.refresh()
    setTimeout(() => {
      onOpenChange(false)
      reset()
    }, 400)
  }

  const uploading = progress !== null && progress < 1

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (uploading) return
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="size-5 text-primary" />
            {t("uploadTitle")}
          </DialogTitle>
          <DialogDescription>{t("uploadHint", { max: refs.settings.max_upload_mb })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files?.[0])
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition",
              dragging ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/40",
            )}
          >
            <UploadCloud className="size-8 text-muted-foreground" />
            {file ? (
              <div className="text-sm">
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("dropHere")}</p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-category">{t("category")}</Label>
              <NativeSelect id="doc-category" value={category} disabled={lockCategory || uploading} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{t(`categories.${c}`)}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-title">{t("docTitle")}</Label>
              <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={uploading} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-notes">{t("notes")}</Label>
            <Textarea id="doc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={uploading} />
          </div>

          <AnimatePresence>
            {progress !== null && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0 }} className="space-y-1.5">
                <Progress value={Math.round(progress * 100)} />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {progress >= 1 ? <CheckCircle2 className="size-3.5 text-success" /> : <Loader2 className="size-3.5 animate-spin" />}
                  {progress >= 1 ? t("done") : t("uploading", { percent: Math.round(progress * 100) })}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          {uploading ? (
            <Button variant="outline" onClick={() => abort.current?.abort()}>
              <X />
              {t("cancelUpload")}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
          )}
          <Button onClick={submit} disabled={!file || uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <FileUp />}
            {t("upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
