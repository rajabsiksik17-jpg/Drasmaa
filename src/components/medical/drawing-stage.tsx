"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage } from "react-konva"
import type Konva from "konva"
import type { DrawingStroke } from "@/types/db"

export const LOGICAL_WIDTH = 1000
export const LOGICAL_HEIGHT = 700

/** Deterministic PRNG so a spray stroke renders identically every time. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function SprayStroke({ stroke }: { stroke: DrawingStroke }) {
  const dots = useMemo(() => {
    const rand = mulberry32(hash(stroke.id))
    const out: { x: number; y: number; r: number }[] = []
    for (let i = 0; i < stroke.points.length; i += 2) {
      for (let k = 0; k < 6; k++) {
        const a = rand() * Math.PI * 2
        const d = rand() * stroke.size * 1.6
        out.push({ x: stroke.points[i] + Math.cos(a) * d, y: stroke.points[i + 1] + Math.sin(a) * d, r: 0.8 + rand() * 1.4 })
      }
    }
    return out
  }, [stroke])
  return (
    <Group listening={false}>
      {dots.map((d, i) => (
        <Circle key={i} x={d.x} y={d.y} radius={d.r} fill={stroke.color} opacity={0.75} perfectDrawEnabled={false} />
      ))}
    </Group>
  )
}

/**
 * Two layers: the unchanged template image, and the annotation layer.
 * The eraser uses destination-out on the annotation layer only.
 */
export default function DrawingStage({
  templateSrc,
  strokes,
  readOnly,
  tool,
  color,
  size,
  onStrokeComplete,
}: {
  templateSrc: string
  strokes: DrawingStroke[]
  readOnly: boolean
  tool: DrawingStroke["tool"]
  color: string
  size: number
  onStrokeComplete: (stroke: DrawingStroke) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [current, setCurrent] = useState<DrawingStroke | null>(null)
  const drawing = useRef(false)
  const currentRef = useRef<DrawingStroke | null>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const img = new window.Image()
    img.onload = () => setImage(img)
    img.src = templateSrc
  }, [templateSrc])

  const scale = width / LOGICAL_WIDTH
  const height = LOGICAL_HEIGHT * scale

  const point = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    return pos ? [pos.x / scale, pos.y / scale] : null
  }

  const start = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (readOnly) return
    const p = point(e)
    if (!p) return
    drawing.current = true
    const stroke: DrawingStroke = { id: crypto.randomUUID().slice(0, 13), tool, color, size, points: p }
    currentRef.current = stroke
    setCurrent(stroke)
  }
  const move = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!drawing.current || !currentRef.current) return
    e.evt.preventDefault()
    const p = point(e)
    if (!p) return
    currentRef.current = { ...currentRef.current, points: [...currentRef.current.points, p[0], p[1]] }
    setCurrent(currentRef.current)
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    // Side effects stay outside state updaters (they may run twice in StrictMode).
    const c = currentRef.current
    currentRef.current = null
    setCurrent(null)
    if (c && c.points.length >= 2) {
      onStrokeComplete(c.points.length === 2 ? { ...c, points: [...c.points, c.points[0] + 0.1, c.points[1] + 0.1] } : c)
    }
  }

  const render = (s: DrawingStroke) =>
    s.tool === "spray" ? (
      <SprayStroke key={s.id} stroke={s} />
    ) : (
      <Line
        key={s.id}
        points={s.points}
        stroke={s.tool === "eraser" ? "#000" : s.color}
        strokeWidth={s.tool === "eraser" ? s.size * 3 : s.size}
        tension={0.4}
        lineCap="round"
        lineJoin="round"
        globalCompositeOperation={s.tool === "eraser" ? "destination-out" : "source-over"}
        listening={false}
        perfectDrawEnabled={false}
      />
    )

  return (
    <div ref={container} className="w-full" style={{ touchAction: readOnly ? "auto" : "none" }}>
      <Stage
        width={width}
        height={height}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        style={{ cursor: readOnly ? "default" : "crosshair" }}
      >
        <Layer listening={false}>{image && <KonvaImage image={image} width={width} height={height} />}</Layer>
        <Layer scaleX={scale} scaleY={scale}>
          {strokes.map(render)}
          {current && render(current)}
        </Layer>
      </Stage>
    </div>
  )
}
