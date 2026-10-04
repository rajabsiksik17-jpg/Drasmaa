"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowUpRight,
  Circle,
  MousePointer2,
  X,
  Eraser,
  Hand,
  Highlighter,
  History,
  Loader2,
  Maximize2,
  Minus,
  PenLine,
  PencilLine,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  Brush,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReasonDialog, useCorrectionReason, useRecordLocked } from "@/components/forms/correction-context"
import { useRegisterTracker, type SaveStatus, type SaveTracker } from "@/components/forms/save-state"
import { DrawingSvg } from "@/components/drawings/drawing-svg"
import { useActionError } from "@/hooks/use-action-error"
import { listDrawingVersions, saveDrawing, saveDrawingPreview } from "@/lib/actions/drawings"
import { COLORS, SIZES, newShapeId, type Tool } from "@/lib/drawing/shapes"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { AnnotationStageHandle } from "@/components/drawings/annotation-stage"
import type { DrawingShape, MedicalDrawing } from "@/types/db"

// Konva needs a real canvas: client only.
const AnnotationStage = dynamic(() => import("@/components/drawings/annotation-stage"), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[4/3] w-full" />,
})

type Version = { id: string; version_no: number; created_at: string; reason: string | null; shapes: DrawingShape[]; notes: string | null }

/**
 * Ultrasound / diagram annotation: original image + vector annotation
 * layer + notes. Autosaves; completed visits require a correction reason
 * (the previous state is kept as a version).
 */
export function DrawingEditor({
  drawing,
  background,
  canEdit,
  visitCompleted,
}: {
  drawing: MedicalDrawing
  background: string | null
  canEdit: boolean
  visitCompleted: boolean
}) {
  const t = useTranslations("drawings")
  const locale = useLocale()
  const contextReason = useCorrectionReason()
  const contextLocked = useRecordLocked()
  const { showError } = useActionError()
  const [ownReason, setOwnReason] = useState<string | null>(null)
  const [askReason, setAskReason] = useState(false)
  const reason = contextReason ?? ownReason
  const needsReason = visitCompleted && !reason
  const readOnly = !canEdit || contextLocked || needsReason

  const [shapes, setShapes] = useState<DrawingShape[]>(drawing.shapes ?? [])
  const [notes, setNotes] = useState(drawing.notes ?? "")
  const [undo, setUndo] = useState<DrawingShape[][]>([])
  const [redo, setRedo] = useState<DrawingShape[][]>([])
  const [tool, setToolState] = useState<Tool>("pen")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const setTool = (next: Tool) => {
    setToolState(next)
    if (next !== "select") setSelectedId(null)
  }
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[1])
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [textAt, setTextAt] = useState<{ x: number; y: number; screenX: number; screenY: number } | null>(null)
  const [textDraft, setTextDraft] = useState("")
  const [versions, setVersions] = useState<Version[] | null>(null)
  const stage = useRef<AnnotationStageHandle>(null)
  const version = useRef(drawing.version)
  const latest = useRef({ shapes, notes })
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const savePreview = useCallback(async () => {
    const png = stage.current?.exportPng()
    if (!png) return
    const res = await saveDrawingPreview({ id: drawing.id, dataUrl: png })
    if (res.ok) version.current = res.data.version
  }, [drawing.id])

  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    if (!dirty.current) return true
    setStatus("saving")
    try {
      const res = await saveDrawing({
        id: drawing.id,
        expectedVersion: version.current,
        shapes: latest.current.shapes,
        notes: latest.current.notes,
        reason,
      })
      if (!res.ok) {
        setStatus("error")
        showError(res.error)
        return false
      }
      version.current = res.data.version
      dirty.current = false
      setSavedAt(Date.now())
      setStatus("saved")
      if (previewTimer.current) clearTimeout(previewTimer.current)
      previewTimer.current = setTimeout(() => void savePreview(), 2500)
      return true
    } catch {
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error")
      return false
    }
  }, [drawing.id, reason, showError, savePreview])

  const schedule = () => {
    dirty.current = true
    setStatus("pending")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), 1500)
  }

  const commit = (next: DrawingShape[]) => {
    setUndo((u) => [...u.slice(-49), shapes])
    setRedo([])
    setShapes(next)
    latest.current = { ...latest.current, shapes: next }
    schedule()
  }

  useEffect(() => () => void save(), [save])

  const tracker = useMemo<SaveTracker>(
    () => ({ status, lastSavedAt: savedAt, dirty: status === "pending" || status === "saving", flush: save, retry: () => void save() }),
    [status, savedAt, save],
  )
  useRegisterTracker(tracker)

  // Selected object: move / resize / rotate (from the stage) or delete — each one undoable.
  const updateShape = (next: DrawingShape) => commit(shapes.map((s) => (s.id === next.id ? next : s)))
  const deleteSelected = () => {
    if (!selectedId) return
    commit(shapes.filter((s) => s.id !== selectedId))
    setSelectedId(null)
  }
  const selected = shapes.find((s) => s.id === selectedId) ?? null
  const recolorSelected = (c: string) => {
    setColor(c)
    if (selected) commit(shapes.map((s) => (s.id === selected.id ? { ...s, color: c } : s)))
  }

  const doUndo = () => {
    setSelectedId(null)
    const prev = undo.at(-1)
    if (!prev) return
    setUndo(undo.slice(0, -1))
    setRedo((r) => [...r, shapes])
    setShapes(prev)
    latest.current = { ...latest.current, shapes: prev }
    schedule()
  }
  const doRedo = () => {
    setSelectedId(null)
    const next = redo.at(-1)
    if (!next) return
    setRedo(redo.slice(0, -1))
    setUndo((u) => [...u, shapes])
    setShapes(next)
    latest.current = { ...latest.current, shapes: next }
    schedule()
  }

  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault()
        deleteSelected()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) doRedo()
        else doUndo()
      } else if (e.key === "Escape") setSelectedId(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const addText = () => {
    if (!textAt || !textDraft.trim()) return setTextAt(null)
    commit([...shapes, { id: newShapeId(), type: "text", x: textAt.x, y: textAt.y, text: textDraft.trim().slice(0, 300), color, size: Math.max(14, size * 5) }])
    setTextAt(null)
    setTextDraft("")
  }

  function zoomIn() {
    stage.current?.zoomBy(1.25)
  }
  function zoomOut() {
    stage.current?.zoomBy(0.8)
  }
  function resetView() {
    stage.current?.resetView()
  }

  const tools: { value: Tool; icon: typeof PenLine; label: string }[] = [
    { value: "select", icon: MousePointer2, label: t("tools.select") },
    { value: "pen", icon: PenLine, label: t("tools.pen") },
    { value: "marker", icon: Brush, label: t("tools.marker") },
    { value: "highlight", icon: Highlighter, label: t("tools.highlight") },
    { value: "line", icon: Minus, label: t("tools.line") },
    { value: "arrow", icon: ArrowUpRight, label: t("tools.arrow") },
    { value: "circle", icon: Circle, label: t("tools.circle") },
    { value: "rect", icon: Square, label: t("tools.rect") },
    { value: "text", icon: Type, label: t("tools.text") },
    { value: "eraser", icon: Eraser, label: t("tools.eraser") },
    { value: "pan", icon: Hand, label: t("tools.pan") },
  ]

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="no-print sticky top-28 z-10 flex flex-wrap items-center gap-1.5 rounded-xl border bg-background/95 p-1.5 shadow-sm backdrop-blur">
          {tools.map((x) => (
            <IconBtn key={x.value} label={x.label} icon={x.icon} onClick={() => setTool(x.value)} active={tool === x.value} />
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => recolorSelected(c)}
              aria-label={c}
              aria-pressed={color === c}
              className={cn("size-6 rounded-full border-2 transition", color === c ? "scale-110 border-primary" : "border-border")}
              style={{ background: c }}
            />
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              aria-label={`${s}px`}
              aria-pressed={size === s}
              className={cn("grid size-7 place-items-center rounded-md border", size === s ? "border-primary bg-primary/10" : "border-border")}
            >
              <span className="rounded-full bg-foreground" style={{ width: Math.min(16, s + 2), height: Math.min(16, s + 2) }} />
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          <IconBtn label={t("undo")} icon={Undo2} onClick={doUndo} disabled={undo.length === 0} />
          <IconBtn label={t("redo")} icon={Redo2} onClick={doRedo} disabled={redo.length === 0} />
          <IconBtn label={t("deleteSelected")} icon={X} onClick={deleteSelected} disabled={!selectedId} />
          <IconBtn label={t("clear")} icon={Trash2} onClick={() => commit([])} disabled={shapes.length === 0} />
          <span className="mx-1 h-6 w-px bg-border" />
          <IconBtn label={t("zoomIn")} icon={ZoomIn} onClick={zoomIn} />
          <IconBtn label={t("zoomOut")} icon={ZoomOut} onClick={zoomOut} />
          <IconBtn label={t("fit")} icon={Maximize2} onClick={resetView} />
          <span className="ms-auto flex items-center gap-1.5 pe-1 text-xs text-muted-foreground">
            {status === "saving" && <Loader2 className="size-3.5 animate-spin" />}
            {status === "saving" ? t("saving") : status === "pending" ? t("unsaved") : status === "saved" ? t("saved") : status === "error" ? t("saveError") : ""}
          </span>
        </div>
      )}

      {needsReason && canEdit && !contextLocked && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("completedHint")}
          <Button size="sm" variant="outline" className="ms-auto" onClick={() => setAskReason(true)}>
            <PencilLine />
            {t("correct")}
          </Button>
        </div>
      )}

      <div className="relative">
        <AnnotationStage
          ref={stage}
          background={background}
          width={drawing.canvas_width}
          height={drawing.canvas_height}
          shapes={shapes}
          tool={readOnly ? "pan" : tool}
          color={color}
          size={size}
          readOnly={readOnly}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={updateShape}
          onAdd={(s) => commit([...shapes, s])}
          onErase={(ids) => {
            commit(shapes.filter((s) => !ids.includes(s.id)))
            if (selectedId && ids.includes(selectedId)) setSelectedId(null)
          }}
          onTextRequest={(at) => {
            setTextDraft("")
            setTextAt(at)
          }}
        />
        {textAt && (
          <div className="absolute z-20 flex gap-1 rounded-lg border bg-background p-1 shadow-lg" style={{ left: Math.max(4, textAt.screenX), top: Math.max(4, textAt.screenY) }}>
            <Input
              autoFocus
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addText()
                if (e.key === "Escape") setTextAt(null)
              }}
              placeholder={t("textPlaceholder")}
              className="h-8 w-48"
              dir="auto"
            />
            <Button size="sm" onClick={addText}>
              {t("add")}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`drawing-notes-${drawing.id}`}>{t("notes")}</Label>
        <Textarea
          id={`drawing-notes-${drawing.id}`}
          value={notes}
          readOnly={readOnly}
          dir="auto"
          onChange={(e) => {
            setNotes(e.target.value)
            latest.current = { ...latest.current, notes: e.target.value }
            schedule()
          }}
          placeholder={t("notesPlaceholder")}
          className="min-h-20"
        />
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t("versionsCount", { count: drawing.saved_versions })}</span>
        <Button
          size="xs"
          variant="ghost"
          onClick={async () => {
            const res = await listDrawingVersions(drawing.id)
            if (res.ok) setVersions(res.data)
            else toast.error(t("saveError"))
          }}
        >
          <History />
          {t("history")}
        </Button>
      </div>

      <ReasonDialog open={askReason} onOpenChange={setAskReason} onConfirm={(r) => setOwnReason(r)} />

      <Dialog open={versions !== null} onOpenChange={(o) => !o && setVersions(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("history")}</DialogTitle>
            <DialogDescription>{t("historyHint")}</DialogDescription>
          </DialogHeader>
          {(versions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noVersions")}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {(versions ?? []).map((v) => (
                <li key={v.id} className="space-y-1.5 rounded-lg border p-2">
                  <p className="text-xs font-medium">
                    {t("versionNo", { n: v.version_no })} · {formatDateTime(v.created_at, locale)}
                  </p>
                  {v.reason && <p className="text-xs text-muted-foreground">{v.reason}</p>}
                  <DrawingSvg shapes={v.shapes} width={drawing.canvas_width} height={drawing.canvas_height} background={background} className="rounded border" />
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IconBtn({ label, icon: Icon, onClick, active, disabled }: { label: string; icon: typeof PenLine; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon-sm" variant={active ? "default" : "outline"} onClick={onClick} disabled={disabled} aria-pressed={active} aria-label={label}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
