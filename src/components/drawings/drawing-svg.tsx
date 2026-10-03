import { arrowHead, box, strokeStyle } from "@/lib/drawing/shapes"
import type { DrawingShape } from "@/types/db"

/**
 * Vector rendering of an annotated image: the untouched original image (or
 * clinic diagram) underneath and the doctor's annotation layer on top.
 * Pure markup — used in print views, PDFs and thumbnails, so the drawing
 * never disappears during PDF generation and stays sharp at any size.
 */
export function DrawingSvg({
  shapes,
  width,
  height,
  background,
  className,
  title,
}: {
  shapes: DrawingShape[]
  width: number
  height: number
  /** data: URL, same-origin path or signed URL of the original image. */
  background: string | null
  className?: string
  title?: string
}) {
  const polyline = (pts: number[]) => {
    const pairs: string[] = []
    for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]},${pts[i + 1]}`)
    return pairs.join(" ")
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {background && <image href={background} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />}
      {shapes.map((s) => {
        switch (s.type) {
          case "pen":
          case "marker":
          case "highlight": {
            const st = strokeStyle(s.type, s.size)
            return (
              <polyline
                key={s.id}
                points={polyline(s.points.length === 2 ? [...s.points, s.points[0] + 0.1, s.points[1] + 0.1] : s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={st.width}
                strokeOpacity={st.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          }
          case "line":
            return <line key={s.id} x1={s.points[0]} y1={s.points[1]} x2={s.points[2]} y2={s.points[3]} stroke={s.color} strokeWidth={s.size} strokeLinecap="round" />
          case "arrow":
            return (
              <g key={s.id}>
                <line x1={s.points[0]} y1={s.points[1]} x2={s.points[2]} y2={s.points[3]} stroke={s.color} strokeWidth={s.size} strokeLinecap="round" />
                <polygon points={polyline(arrowHead(s.points, s.size))} fill={s.color} />
              </g>
            )
          case "rect": {
            const b = box(s)
            return <rect key={s.id} x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={s.color} strokeWidth={s.size} />
          }
          case "circle": {
            const b = box(s)
            return <ellipse key={s.id} cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} fill="none" stroke={s.color} strokeWidth={s.size} />
          }
          case "text":
            return (
              <text
                key={s.id}
                x={s.x}
                y={s.y + s.size}
                fill={s.color}
                fontSize={s.size}
                fontWeight={600}
                fontFamily="Cairo, Arial, sans-serif"
                stroke="#ffffff"
                strokeWidth={Math.max(1, s.size / 10)}
                paintOrder="stroke"
              >
                {s.text}
              </text>
            )
        }
      })}
    </svg>
  )
}
