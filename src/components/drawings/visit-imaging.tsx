"use client"

import { useCallback, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { ArchiveRestore, Camera, ChevronUp, ExternalLink, ImagePlus, Loader2, PenTool, RotateCcw, Shapes, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useCan, useRefs } from "@/components/app-context"
import { DrawingEditor } from "@/components/drawings/drawing-editor"
import { DrawingSvg } from "@/components/drawings/drawing-svg"
import { ExportMenu } from "@/components/documents/export-menu"
import { ReasonDialog } from "@/components/forms/correction-context"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { archiveDrawing, createTemplateDrawing, restoreDrawing } from "@/lib/actions/drawings"
import { precheckUltrasound, readImageSize, ULTRASOUND_ACCEPT, uploadUltrasound } from "@/lib/storage/ultrasound-upload"
import { formatBytes } from "@/lib/storage/files"
import { formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { ClinicalContext, MedicalDrawing } from "@/types/db"

export interface DrawingWithBackground {
  drawing: MedicalDrawing
  /** Signed URL of the original image, or the clinic diagram path. */
  background: string | null
}

type UploadItem = {
  key: string
  file: File
  progress: number
  state: "uploading" | "failed" | "cancelled"
  error?: string
  abort?: AbortController
}

/** Visit → Ultrasound: original images + drawing layers + notes, all in the visit. */
export function VisitImaging({
  patientId,
  visitId,
  context,
  items,
  archived = [],
  visitCompleted,
  visitCancelled,
}: {
  patientId: string
  visitId: string
  context: ClinicalContext
  items: DrawingWithBackground[]
  archived?: DrawingWithBackground[]
  visitCompleted: boolean
  visitCancelled: boolean
}) {
  const t = useTranslations("drawings")
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const { message, showError } = useActionError()
  const [openId, setOpenId] = useState<string | null>(items.length === 1 ? items[0].drawing.id : null)
  const [pending, start] = useSafeTransition()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const canCreate = can(P.drawingsCreate) && !visitCancelled
  const canEdit = !visitCancelled && (can(P.drawingsEdit) || can(P.drawingsCreate))
  const patch = (key: string, p: Partial<UploadItem>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)))

  const runUpload = useCallback(
    async (item: UploadItem) => {
      const abort = new AbortController()
      patch(item.key, { state: "uploading", progress: 0, error: undefined, abort })
      let size: { width: number; height: number }
      try {
        size = await readImageSize(item.file)
      } catch {
        return patch(item.key, { state: "failed", error: t("unreadable") })
      }
      try {
        const res = await uploadUltrasound(item.file, { visitId, context, width: size.width, height: size.height }, (p) => patch(item.key, { progress: p }), abort.signal)
        if (!res.ok) {
          if (res.cancelled) return setUploads((list) => list.filter((u) => u.key !== item.key))
          return patch(item.key, { state: "failed", error: message(res.error, "uploadImage") })
        }
        setUploads((list) => list.filter((u) => u.key !== item.key))
        toast.success(t("uploaded"))
        setOpenId(res.drawingId)
        router.refresh()
      } catch (error) {
        console.error("[upload] failed", error)
        patch(item.key, { state: "failed", error: message({ code: typeof navigator !== "undefined" && !navigator.onLine ? "network" : "unexpected" }, "uploadImage") })
      }
    },
    [context, message, router, t, visitId],
  )

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return
    const next: UploadItem[] = []
    for (const file of Array.from(files).slice(0, 10)) {
      const problem = precheckUltrasound(file, refs.settings.max_upload_mb)
      if (problem) {
        toast.error(problem === "heic" ? t("heic") : message({ code: problem }))
        continue
      }
      next.push({ key: crypto.randomUUID(), file, progress: 0, state: "uploading" })
    }
    if (fileInput.current) fileInput.current.value = ""
    if (cameraInput.current) cameraInput.current.value = ""
    setUploads((list) => [...list, ...next])
    // Sequential: one image at a time is kinder to slow mobile connections.
    void next.reduce((chain, item) => chain.then(() => runUpload(item)), Promise.resolve())
  }

  const diagram = () =>
    start(async () => {
      const res = await createTemplateDrawing({ visitId, templateKey: "pelvis_v1", context })
      if (!res.ok) return showError(res.error)
      setOpenId(res.data.drawingId)
      router.refresh()
    })

  const remove = (id: string, reason: string) =>
    start(async () => {
      const res = await archiveDrawing(id, reason)
      if (!res.ok) return showError(res.error)
      toast.success(t("deleted"))
      if (openId === id) setOpenId(null)
      router.refresh()
    })

  const restore = (id: string) =>
    start(async () => {
      const res = await restoreDrawing(id)
      if (!res.ok) return showError(res.error)
      toast.success(t("restored"))
      router.refresh()
    })

  const label = (d: MedicalDrawing) => d.title ?? (d.image_id ? t("ultrasoundImage") : t("diagram"))

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="no-print flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept={ULTRASOUND_ACCEPT} multiple hidden onChange={(e) => addFiles(e.target.files)} />
          {/* iOS/Android open the camera directly; the photo arrives as JPEG. */}
          <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => addFiles(e.target.files)} />
          <Button onClick={() => fileInput.current?.click()}>
            <ImagePlus />
            {t("uploadImage")}
          </Button>
          <Button variant="outline" onClick={() => cameraInput.current?.click()}>
            <Camera />
            {t("camera")}
          </Button>
          <Button variant="outline" onClick={diagram} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Shapes />}
            {t("drawOnDiagram")}
          </Button>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className={cn("rounded-lg border p-3 text-sm", u.state === "failed" && "border-destructive/40 bg-destructive/5")}>
              <div className="flex items-center gap-2">
                {u.state === "uploading" ? <Loader2 className="size-4 animate-spin text-primary" /> : <ImagePlus className="size-4 text-destructive" />}
                <span className="min-w-0 flex-1 truncate">{u.file.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                  {formatBytes(u.file.size)}
                </span>
                {u.state === "uploading" ? (
                  <Button size="xs" variant="ghost" onClick={() => u.abort?.abort()}>
                    <X />
                    {t("cancelUpload")}
                  </Button>
                ) : (
                  <>
                    <Button size="xs" variant="outline" onClick={() => void runUpload(u)}>
                      <RotateCcw />
                      {t("retry")}
                    </Button>
                    <Button size="icon-xs" variant="ghost" aria-label={t("dismiss")} onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}>
                      <X />
                    </Button>
                  </>
                )}
              </div>
              {u.state === "uploading" ? <Progress value={Math.round(u.progress * 100)} className="mt-2 h-1.5" /> : <p className="mt-1 text-xs text-destructive">{u.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ drawing, background }) => (
            <li key={drawing.id} className={cn("overflow-hidden rounded-xl border bg-card shadow-xs transition", openId === drawing.id && "ring-2 ring-primary/40")}>
              <button type="button" className="block w-full bg-neutral-900/90" onClick={() => setOpenId(openId === drawing.id ? null : drawing.id)}>
                <DrawingSvg shapes={drawing.shapes} width={drawing.canvas_width} height={drawing.canvas_height} background={background} title={label(drawing)} />
              </button>
              <div className="flex items-center gap-1.5 px-3 py-2">
                <PenTool className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{label(drawing)}</span>
                <ExportMenu target={{ type: "drawing", entityId: drawing.id, patientId }} size="icon-sm" />
                <Button size="icon-sm" variant="ghost" asChild aria-label={t("openFull")}>
                  <Link href={`/patients/${patientId}/drawings/${drawing.id}`}>
                    <ExternalLink />
                  </Link>
                </Button>
                {canEdit && (
                  <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={t("delete")} onClick={() => setDeleting(drawing.id)}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AnimatePresence initial={false}>
        {items
          .filter(({ drawing }) => drawing.id === openId)
          .map(({ drawing, background }) => (
            <motion.div key={drawing.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2 rounded-xl border bg-card p-2 sm:p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{label(drawing)}</p>
                <Button size="xs" variant="ghost" onClick={() => setOpenId(null)}>
                  <ChevronUp />
                  {t("collapse")}
                </Button>
              </div>
              <DrawingEditor drawing={drawing} background={background} canEdit={canEdit} visitCompleted={visitCompleted} />
            </motion.div>
          ))}
      </AnimatePresence>

      {archived.length > 0 && can(P.drawingsEdit) && (
        <div className="rounded-lg border border-dashed p-3 text-sm">
          <button type="button" className="flex w-full items-center gap-2 text-muted-foreground" onClick={() => setShowArchived((v) => !v)}>
            <ArchiveRestore className="size-4" />
            {t("archivedCount", { count: archived.length })}
          </button>
          {showArchived && (
            <ul className="mt-2 divide-y">
              {archived.map(({ drawing }) => (
                <li key={drawing.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{label(drawing)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {drawing.archived_at ? formatDateTime(drawing.archived_at) : ""}
                      {drawing.archive_reason ? ` · ${drawing.archive_reason}` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => restore(drawing.id)} disabled={pending}>
                    <ArchiveRestore />
                    {t("restore")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ReasonDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={(r) => {
          const id = deleting
          setDeleting(null)
          if (id) remove(id, r)
        }}
      />
    </div>
  )
}
