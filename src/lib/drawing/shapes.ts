import type { DrawingShape } from "@/types/db"

// Shared geometry for the annotation editor (Konva) and the print/PDF
// renderer (SVG): both draw from these helpers, so the printed drawing is
// exactly what the doctor saw.

export type ShapeTool = DrawingShape["type"]
export type Tool = ShapeTool | "eraser" | "pan" | "select"

export const COLORS = ["#e11d2e", "#1d4ed8", "#059669", "#111827", "#f59e0b", "#7c3aed", "#ffffff"]
export const SIZES = [2, 4, 8, 14]

/** Visual style per freehand tool. */
export function strokeStyle(type: ShapeTool, size: number) {
  if (type === "marker") return { width: size * 2, opacity: 0.9 }
  if (type === "highlight") return { width: size * 5, opacity: 0.35 }
  return { width: size, opacity: 1 }
}

/** Arrow head as a closed triangle at (x2, y2). */
export function arrowHead(points: [number, number, number, number], size: number): number[] {
  const [x1, y1, x2, y2] = points
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const len = Math.max(10, size * 4)
  const spread = Math.PI / 7
  return [
    x2,
    y2,
    x2 - len * Math.cos(angle - spread),
    y2 - len * Math.sin(angle - spread),
    x2 - len * Math.cos(angle + spread),
    y2 - len * Math.sin(angle + spread),
  ]
}

/** Normalized box (handles drags in any direction). */
export function box(s: { x: number; y: number; w: number; h: number }) {
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) }
}

export const textWidth = (text: string, size: number) => text.length * size * 0.56

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** Rotation (degrees) of boxes and text; point-based shapes have it baked into their points. */
export const rotationOf = (s: DrawingShape) => ((s.type === "rect" || s.type === "circle" || s.type === "text") && s.rotation ? s.rotation : 0)

/** Object eraser / selection: does the pointer touch this shape? (canvas coordinates) */
export function hitTest(s: DrawingShape, x: number, y: number, tolerance: number): boolean {
  const r = rotationOf(s)
  if (r && (s.type === "rect" || s.type === "circle" || s.type === "text")) {
    // Test in the shape's own (unrotated) frame, which rotates around its top-left corner.
    const origin = s.type === "text" ? { x: s.x, y: s.y } : { x: box(s).x, y: box(s).y }
    const a = (-r * Math.PI) / 180
    const dx = x - origin.x
    const dy = y - origin.y
    const lx = dx * Math.cos(a) - dy * Math.sin(a)
    const ly = dx * Math.sin(a) + dy * Math.cos(a)
    const local = s.type === "text" ? { ...s, x: 0, y: 0, rotation: 0 } : { ...s, x: 0, y: 0, w: Math.abs(s.w), h: Math.abs(s.h), rotation: 0 }
    return hitTest(local, lx, ly, tolerance)
  }
  switch (s.type) {
    case "pen":
    case "marker":
    case "highlight": {
      const w = strokeStyle(s.type, s.size).width / 2 + tolerance
      for (let i = 0; i + 3 < s.points.length; i += 2) {
        if (distToSegment(x, y, s.points[i], s.points[i + 1], s.points[i + 2], s.points[i + 3]) <= w) return true
      }
      return s.points.length === 2 && Math.hypot(x - s.points[0], y - s.points[1]) <= w
    }
    case "line":
    case "arrow":
      return distToSegment(x, y, ...s.points) <= s.size / 2 + tolerance
    case "rect": {
      const b = box(s)
      const inside = x >= b.x - tolerance && x <= b.x + b.w + tolerance && y >= b.y - tolerance && y <= b.y + b.h + tolerance
      const deep = x > b.x + tolerance && x < b.x + b.w - tolerance && y > b.y + tolerance && y < b.y + b.h - tolerance
      return inside && !deep
    }
    case "circle": {
      const b = box(s)
      const rx = b.w / 2
      const ry = b.h / 2
      if (rx < 1 || ry < 1) return Math.hypot(x - b.x, y - b.y) <= tolerance
      const d = Math.hypot((x - b.x - rx) / rx, (y - b.y - ry) / ry)
      return Math.abs(d - 1) * Math.min(rx, ry) <= tolerance + s.size / 2
    }
    case "text":
      return x >= s.x - tolerance && x <= s.x + textWidth(s.text, s.size) + tolerance && y >= s.y - tolerance && y <= s.y + s.size * 1.3 + tolerance
  }
}

export const newShapeId = () => Math.random().toString(36).slice(2, 12)

/** The top-most shape under the pointer (last drawn wins), for selection. */
export function topShapeAt(shapes: DrawingShape[], x: number, y: number, tolerance: number): DrawingShape | null {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitTest(shapes[i], x, y, tolerance)) return shapes[i]
  return null
}
