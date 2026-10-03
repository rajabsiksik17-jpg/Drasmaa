"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { Eraser, Loader2, Pen, Redo2, SprayCan, Trash2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useRegisterTracker, type SaveStatus, type SaveTracker } from "@/components/forms/save-state"
import { useCorrectionReason, useRecordLocked } from "@/components/forms/correction-context"
import { useActionError } from "@/hooks/use-action-error"
import { saveAnnotation } from "@/lib/actions/clinical"
import { cn } from "@/lib/utils"
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "@/components/medical/drawing-stage"
import type { DrawingStroke, UltrasoundAnnotation } from "@/types/db"

// Konva needs a real canvas: render client-side only.
const DrawingStage = dynamic(() => import("@/components/medical/drawing-stage"), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[10/7] w-full" />,
})

const COLORS = ["#d11a2a", "#1f4fd1", "#0f8a4a", "#111111", "#e07b00", "#8a2be2"]
const SIZES = [2, 4, 8]

export function MedicalDrawingCanvas({
  patientId,
  visitId,
  templateKey,
  initial,
  canEdit,
}: {
  patientId: string
  visitId: string
  templateKey: string
  initial: UltrasoundAnnotation | null
  canEdit: boolean
}) {
  const t = useTranslations("drawing")
  const reason = useCorrectionReason()
  const locked = useRecordLocked()
  const { showError } = useActionError()
  const readOnly = !canEdit || locked
  const [strokes, setStrokes] = useState<DrawingStroke[]>(initial?.strokes ?? [])
  const [redo, setRedo] = useState<DrawingStroke[]>([])
  const [tool, setTool] = useState<DrawingStroke["tool"]>("pen")
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[1])
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const version = useRef<number | null>(initial?.version ?? null)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(strokes)
  useEffect(() => {
    latest.current = strokes
  }, [strokes])

  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    if (!dirty.current) return true
    setStatus("saving")
    // A concurrent edit is merged (theirs + ours) and retried a few times.
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Awaited<ReturnType<typeof saveAnnotation>>
      try {
        res = await saveAnnotation({
        patientId,
        visitId,
        templateKey,
        strokes: latest.current,
        width: LOGICAL_WIDTH,
        height: LOGICAL_HEIGHT,
        expectedVersion: version.current,
        reason,
        })
      } catch {
        // Thrown (not returned) failures: network down or server unreachable.
        setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error")
        return false
      }
      if (res.ok) {
        version.current = res.data.version
        dirty.current = false
        setSavedAt(Date.now())
        setStatus("saved")
        return true
      }
      if (res.error.code === "conflict" && "latest" in res && res.latest) {
        // Someone else changed the drawing: keep theirs and re-apply ours on top.
        const theirs = res.latest.strokes
        const mineOnly = latest.current.filter((s) => !theirs.some((x) => x.id === s.id))
        version.current = res.latest.version
        latest.current = [...theirs, ...mineOnly]
        setStrokes(latest.current)
        continue
      }
      setStatus("error")
      showError(res.error)
      return false
    }
    setStatus("error")
    return false
  }, [patientId, visitId, templateKey, reason, showError])

  const changed = (next: DrawingStroke[]) => {
    setStrokes(next)
    latest.current = next
    dirty.current = true
    setStatus("pending")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), 1200)
  }

  useEffect(() => () => void save(), [save])

  const tracker = useMemo<SaveTracker>(
    () => ({ status, lastSavedAt: savedAt, dirty: status === "pending" || status === "saving", flush: save, retry: () => void save() }),
    [status, savedAt, save],
  )
  useRegisterTracker(tracker)

  const toolButton = (value: DrawingStroke["tool"], Icon: typeof Pen, label: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={tool === value ? "default" : "outline"}
          onClick={() => setTool(value)}
          aria-pressed={tool === value}
          aria-label={label}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border bg-background/80 p-1.5">
          {toolButton("pen", Pen, t("pen"))}
          {toolButton("spray", SprayCan, t("spray"))}
          {toolButton("eraser", Eraser, t("eraser"))}
          <span className="mx-1 h-6 w-px bg-border" />
          <div className="flex items-center gap-1" role="radiogroup" aria-label={t("color")}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => {
                  setColor(c)
                  if (tool === "eraser") setTool("pen")
                }}
                className={cn("size-6 rounded-full border-2 transition", color === c ? "scale-110 border-foreground" : "border-transparent")}
                style={{ background: c }}
              />
            ))}
          </div>
          <span className="mx-1 h-6 w-px bg-border" />
          <div className="flex items-center gap-1" role="radiogroup" aria-label={t("size")}>
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={size === s}
                aria-label={`${t("size")} ${s}`}
                onClick={() => setSize(s)}
                className={cn("grid size-7 place-items-center rounded-md border", size === s ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted")}
              >
                <span className="rounded-full bg-foreground" style={{ width: s + 2, height: s + 2 }} />
              </button>
            ))}
          </div>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("undo")}
            disabled={strokes.length === 0}
            onClick={() => {
              setRedo((r) => [...r, strokes[strokes.length - 1]])
              changed(strokes.slice(0, -1))
            }}
          >
            <Undo2 />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("redo")}
            disabled={redo.length === 0}
            onClick={() => {
              const last = redo[redo.length - 1]
              setRedo((r) => r.slice(0, -1))
              changed([...strokes, last])
            }}
          >
            <Redo2 />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("clear")}
            disabled={strokes.length === 0}
            onClick={() => {
              if (window.confirm(t("clearConfirm"))) {
                setRedo([])
                changed([])
              }
            }}
          >
            <Trash2 />
          </Button>
          <span className="ms-auto pe-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            {status === "saving" || status === "pending" ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                {t("saving")}
              </span>
            ) : status === "saved" ? (
              t("saved")
            ) : status === "error" ? (
              <span className="text-destructive">{t("failed")}</span>
            ) : null}
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded border border-[color:var(--paper-line)] bg-white">
        <DrawingStage
          templateSrc={`/templates/${templateKey}.svg`}
          strokes={strokes}
          readOnly={readOnly}
          tool={tool}
          color={color}
          size={size}
          onStrokeComplete={(s) => {
            setRedo([])
            changed([...latest.current, s])
          }}
        />
      </div>
    </div>
  )
}
