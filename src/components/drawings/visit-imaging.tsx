"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Camera, ChevronUp, ExternalLink, ImagePlus, Loader2, PenTool, Shapes } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useCan } from "@/components/app-context"
import { DrawingEditor } from "@/components/drawings/drawing-editor"
import { DrawingSvg } from "@/components/drawings/drawing-svg"
import { ExportMenu } from "@/components/documents/export-menu"
import { useActionError } from "@/hooks/use-action-error"
import { createTemplateDrawing, uploadUltrasoundImage } from "@/lib/actions/drawings"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { ClinicalContext, MedicalDrawing } from "@/types/db"

export interface DrawingWithBackground {
  drawing: MedicalDrawing
  /** Signed URL of the original image, or the clinic diagram path. */
  background: string | null
}

const readSize = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("unreadable"))
    }
    img.src = url
  })

/** Visit → Ultrasound: original images + drawing layers + notes, all in the visit. */
export function VisitImaging({
  patientId,
  visitId,
  context,
  items,
  visitCompleted,
  visitCancelled,
}: {
  patientId: string
  visitId: string
  context: ClinicalContext
  items: DrawingWithBackground[]
  visitCompleted: boolean
  visitCancelled: boolean
}) {
  const t = useTranslations("drawings")
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [openId, setOpenId] = useState<string | null>(items.length === 1 ? items[0].drawing.id : null)
  const [pending, start] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const canCreate = can(P.drawingsCreate) && !visitCancelled
  const canEdit = !visitCancelled && (can(P.drawingsEdit) || can(P.drawingsCreate))

  const upload = (file: File | undefined) => {
    if (!file) return
    start(async () => {
      let size: { width: number; height: number }
      try {
        size = await readSize(file)
      } catch {
        return void toast.error(t("unreadable"))
      }
      const fd = new FormData()
      fd.set("visitId", visitId)
      fd.set("context", context)
      fd.set("width", String(size.width))
      fd.set("height", String(size.height))
      fd.set("file", file)
      const res = await uploadUltrasoundImage(fd)
      if (fileInput.current) fileInput.current.value = ""
      if (cameraInput.current) cameraInput.current.value = ""
      if (!res.ok) return showError(res.error)
      toast.success(t("uploaded"))
      setOpenId(res.data.drawingId)
      router.refresh()
    })
  }

  const diagram = () =>
    start(async () => {
      const res = await createTemplateDrawing({ visitId, templateKey: "pelvis_v1", context })
      if (!res.ok) return showError(res.error)
      setOpenId(res.data.drawingId)
      router.refresh()
    })

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="no-print flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <Button onClick={() => fileInput.current?.click()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            {t("uploadImage")}
          </Button>
          <Button variant="outline" onClick={() => cameraInput.current?.click()} disabled={pending} className="sm:hidden">
            <Camera />
            {t("camera")}
          </Button>
          <Button variant="outline" onClick={diagram} disabled={pending}>
            <Shapes />
            {t("drawOnDiagram")}
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ drawing, background }) => (
            <li
              key={drawing.id}
              className={cn("overflow-hidden rounded-xl border bg-card shadow-xs transition", openId === drawing.id && "ring-2 ring-primary/40")}
            >
              <button type="button" className="block w-full bg-neutral-900/90" onClick={() => setOpenId(openId === drawing.id ? null : drawing.id)}>
                <DrawingSvg shapes={drawing.shapes} width={drawing.canvas_width} height={drawing.canvas_height} background={background} title={drawing.title ?? t("title")} />
              </button>
              <div className="flex items-center gap-1.5 px-3 py-2">
                <PenTool className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{drawing.title ?? (drawing.image_id ? t("ultrasoundImage") : t("diagram"))}</span>
                <ExportMenu target={{ type: "drawing", entityId: drawing.id, patientId }} size="icon-sm" />
                <Button size="icon-sm" variant="ghost" asChild aria-label={t("openFull")}>
                  <Link href={`/patients/${patientId}/drawings/${drawing.id}`}>
                    <ExternalLink />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AnimatePresence initial={false}>
        {items
          .filter(({ drawing }) => drawing.id === openId)
          .map(({ drawing, background }) => (
            <motion.div key={drawing.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2 rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{drawing.title ?? (drawing.image_id ? t("ultrasoundImage") : t("diagram"))}</p>
                <Button size="xs" variant="ghost" onClick={() => setOpenId(null)}>
                  <ChevronUp />
                  {t("collapse")}
                </Button>
              </div>
              <DrawingEditor drawing={drawing} background={background} canEdit={canEdit} visitCompleted={visitCompleted} />
            </motion.div>
          ))}
      </AnimatePresence>
    </div>
  )
}
