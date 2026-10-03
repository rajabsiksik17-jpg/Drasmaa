"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Ellipse, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva"
import type Konva from "konva"
import { arrowHead, box, hitTest, newShapeId, strokeStyle, type Tool } from "@/lib/drawing/shapes"
import type { DrawingShape } from "@/types/db"

export interface AnnotationStageHandle {
  /** PNG of original + annotations at (up to) the canvas resolution. */
  exportPng: () => string | null
  zoomBy: (factor: number) => void
  resetView: () => void
}

interface Props {
  background: string | null
  width: number
  height: number
  shapes: DrawingShape[]
  tool: Tool
  color: string
  size: number
  readOnly: boolean
  onAdd: (shape: DrawingShape) => void
  onErase: (ids: string[]) => void
  onTextRequest: (at: { x: number; y: number; screenX: number; screenY: number }) => void
}

function ShapeNode({ s }: { s: DrawingShape }) {
  switch (s.type) {
    case "pen":
    case "marker":
    case "highlight": {
      const st = strokeStyle(s.type, s.size)
      return (
        <Line
          points={s.points.length === 2 ? [...s.points, s.points[0] + 0.1, s.points[1] + 0.1] : s.points}
          stroke={s.color}
          strokeWidth={st.width}
          opacity={st.opacity}
          lineCap="round"
          lineJoin="round"
          tension={0.3}
          listening={false}
          perfectDrawEnabled={false}
        />
      )
    }
    case "line":
      return <Line points={s.points} stroke={s.color} strokeWidth={s.size} lineCap="round" listening={false} />
    case "arrow":
      return (
        <>
          <Line points={s.points} stroke={s.color} strokeWidth={s.size} lineCap="round" listening={false} />
          <Line points={arrowHead(s.points, s.size)} closed fill={s.color} listening={false} />
        </>
      )
    case "rect": {
      const b = box(s)
      return <Rect x={b.x} y={b.y} width={b.w} height={b.h} stroke={s.color} strokeWidth={s.size} listening={false} />
    }
    case "circle": {
      const b = box(s)
      return <Ellipse x={b.x + b.w / 2} y={b.y + b.h / 2} radiusX={b.w / 2} radiusY={b.h / 2} stroke={s.color} strokeWidth={s.size} listening={false} />
    }
    case "text":
      return (
        <Text
          x={s.x}
          y={s.y}
          text={s.text}
          fontSize={s.size}
          fontStyle="600"
          fontFamily="Cairo, Arial, sans-serif"
          fill={s.color}
          stroke="#ffffff"
          strokeWidth={Math.max(1, s.size / 10)}
          fillAfterStrokeEnabled
          listening={false}
        />
      )
  }
}

/**
 * Konva stage: original image layer (never modified) + annotation layer.
 * Pointer events cover mouse, touch and stylus; two fingers pinch-zoom and
 * pan; the "pan" tool (or ctrl/⌘ + wheel) moves and zooms the view.
 */
const AnnotationStage = forwardRef<AnnotationStageHandle, Props>(function AnnotationStage(props, ref) {
  const { background, width, height, shapes, tool, color, size, readOnly, onAdd, onErase, onTextRequest } = props
  const container = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [viewWidth, setViewWidth] = useState(800)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draft, setDraft] = useState<DrawingShape | null>(null)
  const draftRef = useRef<DrawingShape | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number; mid: { x: number; y: number }; pan: { x: number; y: number } } | null>(null)
  const panStart = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setViewWidth(Math.max(260, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!background) return
    let cancelled = false
    const load = (cors: boolean) => {
      const img = new window.Image()
      if (cors && !background.startsWith("data:") && !background.startsWith("/")) img.crossOrigin = "anonymous"
      img.onload = () => !cancelled && setImage(img)
      // Without CORS headers the image still displays (only the PNG preview is skipped).
      img.onerror = () => cors && load(false)
      img.src = background
    }
    load(true)
    return () => {
      cancelled = true
    }
  }, [background])

  // Fit the whole image in the available width and ~72% of the screen height.
  const maxHeight = typeof window === "undefined" ? 900 : Math.max(320, window.innerHeight * 0.72)
  const fit = Math.min(viewWidth / width, maxHeight / height)
  const stageWidth = Math.round(width * fit)
  const viewHeight = Math.round(height * fit)
  const scale = fit * zoom

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      const stage = stageRef.current
      if (!stage) return null
      const prev = { scale: stage.scaleX(), x: stage.x(), y: stage.y(), w: stage.width(), h: stage.height() }
      const target = Math.min(width, 1800)
      const s = target / width
      stage.scale({ x: s, y: s })
      stage.position({ x: 0, y: 0 })
      stage.size({ width: width * s, height: height * s })
      let url: string | null = null
      try {
        url = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" })
      } catch {
        url = null // image without CORS headers: preview skipped, PDF still uses the vector renderer
      }
      stage.scale({ x: prev.scale, y: prev.scale })
      stage.position({ x: prev.x, y: prev.y })
      stage.size({ width: prev.w, height: prev.h })
      return url
    },
    zoomBy: (f) => setZoom((z) => Math.min(8, Math.max(1, z * f))),
    resetView: () => {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    },
  }))

  const toCanvas = (p: { x: number; y: number }) => ({ x: (p.x - pan.x) / scale, y: (p.y - pan.y) / scale })

  const eraseAt = (p: { x: number; y: number }) => {
    const hits = shapes.filter((s) => hitTest(s, p.x, p.y, 8 / scale)).map((s) => s.id)
    if (hits.length) onErase(hits)
  }

  const down = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    pointers.current.set(e.evt.pointerId, pos)
    if (pointers.current.size === 2) {
      // Second finger: switch to pinch zoom / pan, cancel the stroke in progress.
      draftRef.current = null
      setDraft(null)
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, pan }
      return
    }
    if (tool === "pan" || readOnly) {
      panStart.current = { x: pos.x, y: pos.y, pan }
      return
    }
    const p = toCanvas(pos)
    if (tool === "eraser") return eraseAt(p)
    if (tool === "text") {
      onTextRequest({ x: p.x, y: p.y, screenX: pos.x + (viewWidth - stageWidth) / 2, screenY: pos.y })
      return
    }
    const id = newShapeId()
    const s: DrawingShape =
      tool === "pen" || tool === "marker" || tool === "highlight"
        ? { id, type: tool, points: [p.x, p.y], color, size }
        : tool === "line" || tool === "arrow"
          ? { id, type: tool, points: [p.x, p.y, p.x, p.y], color, size }
          : { id, type: tool, x: p.x, y: p.y, w: 0, h: 0, color, size }
    draftRef.current = s
    setDraft(s)
  }

  const move = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos || !pointers.current.has(e.evt.pointerId)) return
    pointers.current.set(e.evt.pointerId, pos)
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const nextZoom = Math.min(8, Math.max(1, (pinch.current.zoom * dist) / Math.max(1, pinch.current.dist)))
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = nextZoom / pinch.current.zoom
      setZoom(nextZoom)
      setPan({
        x: mid.x - (pinch.current.mid.x - pinch.current.pan.x) * k,
        y: mid.y - (pinch.current.mid.y - pinch.current.pan.y) * k,
      })
      return
    }
    if (panStart.current) {
      setPan({ x: panStart.current.pan.x + pos.x - panStart.current.x, y: panStart.current.pan.y + pos.y - panStart.current.y })
      return
    }
    const p = toCanvas(pos)
    if (tool === "eraser" && e.evt.buttons) return eraseAt(p)
    const d = draftRef.current
    if (!d) return
    e.evt.preventDefault()
    let next: DrawingShape
    if (d.type === "pen" || d.type === "marker" || d.type === "highlight") next = { ...d, points: [...d.points, p.x, p.y] }
    else if (d.type === "line" || d.type === "arrow") next = { ...d, points: [d.points[0], d.points[1], p.x, p.y] }
    else if (d.type === "rect" || d.type === "circle") next = { ...d, w: p.x - d.x, h: p.y - d.y }
    else return
    draftRef.current = next
    setDraft(next)
  }

  const up = (e: Konva.KonvaEventObject<PointerEvent>) => {
    pointers.current.delete(e.evt.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    panStart.current = null
    const d = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (!d) return
    const tiny =
      (d.type === "line" || d.type === "arrow") ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) < 3 / scale
      : d.type === "rect" || d.type === "circle" ? Math.abs(d.w) < 3 / scale && Math.abs(d.h) < 3 / scale
      : false
    if (!tiny) onAdd(d)
  }

  const wheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!(e.evt.ctrlKey || e.evt.metaKey)) return
    e.evt.preventDefault()
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    const nextZoom = Math.min(8, Math.max(1, zoom * (e.evt.deltaY < 0 ? 1.15 : 1 / 1.15)))
    const k = nextZoom / zoom
    setZoom(nextZoom)
    setPan({ x: pos.x - (pos.x - pan.x) * k, y: pos.y - (pos.y - pan.y) * k })
  }

  const cursor = readOnly || tool === "pan" ? "grab" : tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair"

  return (
    <div ref={container} className="flex w-full justify-center overflow-hidden rounded-lg border bg-neutral-900/90" style={{ touchAction: "none" }}>
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={viewHeight}
        scaleX={scale}
        scaleY={scale}
        x={pan.x}
        y={pan.y}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        onWheel={wheel}
        style={{ cursor }}
      >
        <Layer listening={false}>
          {image ? <KonvaImage image={image} width={width} height={height} /> : <Rect width={width} height={height} fill="#ffffff" />}
        </Layer>
        <Layer listening={false}>
          {shapes.map((s) => (
            <ShapeNode key={s.id} s={s} />
          ))}
          {draft && <ShapeNode s={draft} />}
        </Layer>
      </Stage>
    </div>
  )
})

export default AnnotationStage
