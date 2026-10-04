"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva"
import type Konva from "konva"
import { arrowHead, box, hitTest, newShapeId, strokeStyle, topShapeAt, type Tool } from "@/lib/drawing/shapes"
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
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (shape: DrawingShape) => void
  /** A selected object was moved / resized / rotated. */
  onUpdate: (shape: DrawingShape) => void
  onErase: (ids: string[]) => void
  onTextRequest: (at: { x: number; y: number; screenX: number; screenY: number }) => void
}

/**
 * One annotation as its own Konva group (an individual object): boxes and
 * text sit at their top-left corner and carry their rotation; point-based
 * shapes are drawn in canvas coordinates.
 */
function ShapeNode({ s, selected, draggable, onDragEnd, nodeRef }: {
  s: DrawingShape
  selected?: boolean
  draggable?: boolean
  onDragEnd?: (node: Konva.Group) => void
  nodeRef?: (node: Konva.Group | null) => void
}) {
  const common = {
    ref: nodeRef,
    draggable,
    listening: !!draggable,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd?.(e.target as unknown as Konva.Group),
  }
  const halo = selected ? { shadowColor: "#38bdf8", shadowBlur: 8, shadowOpacity: 0.9 } : {}
  switch (s.type) {
    case "pen":
    case "marker":
    case "highlight": {
      const st = strokeStyle(s.type, s.size)
      return (
        <Group {...common}>
          <Line
            points={s.points.length === 2 ? [...s.points, s.points[0] + 0.1, s.points[1] + 0.1] : s.points}
            stroke={s.color}
            strokeWidth={st.width}
            hitStrokeWidth={Math.max(st.width, 16)}
            opacity={st.opacity}
            lineCap="round"
            lineJoin="round"
            tension={0.3}
            perfectDrawEnabled={false}
            {...halo}
          />
        </Group>
      )
    }
    case "line":
      return (
        <Group {...common}>
          <Line points={s.points} stroke={s.color} strokeWidth={s.size} hitStrokeWidth={Math.max(s.size, 16)} lineCap="round" {...halo} />
        </Group>
      )
    case "arrow":
      return (
        <Group {...common}>
          <Line points={s.points} stroke={s.color} strokeWidth={s.size} hitStrokeWidth={Math.max(s.size, 16)} lineCap="round" {...halo} />
          <Line points={arrowHead(s.points, s.size)} closed fill={s.color} {...halo} />
        </Group>
      )
    case "rect": {
      const b = box(s)
      return (
        <Group {...common} x={b.x} y={b.y} rotation={s.rotation ?? 0}>
          <Rect width={b.w} height={b.h} stroke={s.color} strokeWidth={s.size} hitStrokeWidth={Math.max(s.size, 16)} strokeScaleEnabled={false} {...halo} />
        </Group>
      )
    }
    case "circle": {
      const b = box(s)
      return (
        <Group {...common} x={b.x} y={b.y} rotation={s.rotation ?? 0}>
          <Ellipse x={b.w / 2} y={b.h / 2} radiusX={b.w / 2} radiusY={b.h / 2} stroke={s.color} strokeWidth={s.size} hitStrokeWidth={Math.max(s.size, 16)} strokeScaleEnabled={false} {...halo} />
        </Group>
      )
    }
    case "text":
      return (
        <Group {...common} x={s.x} y={s.y} rotation={s.rotation ?? 0}>
          <Text
            text={s.text}
            fontSize={s.size}
            fontStyle="600"
            fontFamily="Cairo, Arial, sans-serif"
            fill={s.color}
            stroke="#ffffff"
            strokeWidth={Math.max(1, s.size / 10)}
            fillAfterStrokeEnabled
            {...halo}
          />
        </Group>
      )
  }
}

/** New geometry of a shape after its group was dragged / transformed (then the group is reset). */
function applyTransform(s: DrawingShape, node: Konva.Group): DrawingShape {
  const round = (n: number) => Math.round(n * 10) / 10
  const bake = (points: number[]) => {
    const m = node.getTransform()
    const out: number[] = []
    for (let i = 0; i + 1 < points.length; i += 2) {
      const p = m.point({ x: points[i], y: points[i + 1] })
      out.push(round(p.x), round(p.y))
    }
    node.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
    return out
  }
  // Sizes are always stored positive (a flipped box keeps its geometry, not a negative size).
  const sx = Math.abs(node.scaleX())
  const sy = Math.abs(node.scaleY())
  const rotation = round(((node.rotation() % 360) + 360) % 360)
  switch (s.type) {
    case "pen":
    case "marker":
    case "highlight":
      return { ...s, points: bake(s.points) }
    case "line":
    case "arrow": {
      const p = bake(s.points)
      return { ...s, points: [p[0], p[1], p[2], p[3]] }
    }
    case "text":
      node.setAttrs({ scaleX: 1, scaleY: 1 })
      return { ...s, x: round(node.x()), y: round(node.y()), size: Math.min(400, Math.max(8, round(s.size * Math.max(sx, sy)))), rotation }
    case "rect":
    case "circle":
      node.setAttrs({ scaleX: 1, scaleY: 1 })
      return { ...s, x: round(node.x()), y: round(node.y()), w: round(Math.abs(s.w) * sx), h: round(Math.abs(s.h) * sy), rotation }
  }
}

/**
 * Konva stage: original image layer (never modified) + annotation layer.
 * Pointer events cover mouse, touch and stylus; two fingers pinch-zoom and
 * pan; the "pan" tool (or ctrl/⌘ + wheel) moves and zooms the view. The
 * "select" tool picks one object, which can then be moved, resized,
 * rotated or deleted on its own.
 */
const AnnotationStage = forwardRef<AnnotationStageHandle, Props>(function AnnotationStage(props, ref) {
  const { background, width, height, shapes, tool, color, size, readOnly, selectedId, onSelect, onAdd, onUpdate, onErase, onTextRequest } = props
  const container = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const transformer = useRef<Konva.Transformer>(null)
  const selectedNode = useRef<Konva.Group | null>(null)
  const [viewWidth, setViewWidth] = useState(800)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draft, setDraft] = useState<DrawingShape | null>(null)
  const draftRef = useRef<DrawingShape | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number; mid: { x: number; y: number }; pan: { x: number; y: number } } | null>(null)
  const panStart = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null)
  const selecting = tool === "select" && !readOnly
  const selected = selecting ? shapes.find((s) => s.id === selectedId) ?? null : null

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

  // Attach the transform handles to the selected object.
  useEffect(() => {
    const tr = transformer.current
    if (!tr) return
    tr.nodes(selected && selectedNode.current ? [selectedNode.current] : [])
    tr.getLayer()?.batchDraw()
  }, [selected, shapes])

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
      const tr = transformer.current
      const nodes = tr?.nodes() ?? []
      tr?.nodes([])
      const prev = { scale: stage.scaleX(), x: stage.x(), y: stage.y(), w: stage.width(), h: stage.height() }
      const target = Math.min(width, 1800)
      const s = target / width
      stage.scale({ x: s, y: s })
      stage.position({ x: 0, y: 0 })
      stage.size({ width: width * s, height: height * s })
      let url: string | null = null
      try {
        url = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" })
      } catch (error) {
        // Image served without CORS headers: preview skipped, PDF still uses the vector renderer.
        console.warn("[drawing] preview export skipped", error)
        url = null
      }
      stage.scale({ x: prev.scale, y: prev.scale })
      stage.position({ x: prev.x, y: prev.y })
      stage.size({ width: prev.w, height: prev.h })
      tr?.nodes(nodes)
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
    if (selecting) {
      // Handles and the selected object manage their own drag / transform.
      const target = e.target
      if (target.getParent()?.className === "Transformer" || (selected && target.findAncestor((n: Konva.Node) => n === selectedNode.current, true))) return
      const hit = topShapeAt(shapes, p.x, p.y, 10 / scale)
      onSelect(hit?.id ?? null)
      return
    }
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
          : { id, type: tool as "rect" | "circle", x: p.x, y: p.y, w: 0, h: 0, color, size }
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
    if (selecting) return
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
      d.type === "line" || d.type === "arrow"
        ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) < 3 / scale
        : d.type === "rect" || d.type === "circle"
          ? Math.abs(d.w) < 3 / scale && Math.abs(d.h) < 3 / scale
          : false
    if (tiny) return
    // Boxes are stored normalized (top-left + positive size): rotation then has one origin.
    onAdd(d.type === "rect" || d.type === "circle" ? { ...d, ...box(d) } : d)
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

  const commitNode = (node: Konva.Group) => {
    if (selected) onUpdate(applyTransform(selected, node))
  }

  const cursor = readOnly || tool === "pan" ? "grab" : tool === "eraser" ? "cell" : tool === "text" ? "text" : selecting ? "default" : "crosshair"
  const keepRatio = selected?.type === "text"

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
        <Layer listening={selecting}>
          {shapes.map((s) =>
            selected?.id === s.id ? (
              <ShapeNode
                key={s.id}
                s={s}
                selected
                draggable
                nodeRef={(node) => {
                  selectedNode.current = node
                }}
                onDragEnd={commitNode}
              />
            ) : (
              <ShapeNode key={s.id} s={s} />
            ),
          )}
          {draft && <ShapeNode s={draft} />}
          {selecting && (
            <Transformer
              ref={transformer}
              rotateEnabled
              flipEnabled={false}
              keepRatio={keepRatio}
              enabledAnchors={keepRatio ? ["top-left", "top-right", "bottom-left", "bottom-right"] : undefined}
              anchorSize={14}
              borderStroke="#38bdf8"
              anchorStroke="#0284c7"
              anchorCornerRadius={3}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              ignoreStroke
              boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 6 || Math.abs(newBox.height) < 6 ? oldBox : newBox)}
              onTransformEnd={() => selectedNode.current && commitNode(selectedNode.current)}
            />
          )}
        </Layer>
      </Stage>
    </div>
  )
})

export default AnnotationStage
