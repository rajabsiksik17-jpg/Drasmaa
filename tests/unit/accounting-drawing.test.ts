import { afterEach, describe, expect, it, vi } from "vitest"
import { toCsv } from "@/lib/accounting/csv"
import { resolveRange } from "@/lib/accounting/ranges"
import { box, hitTest } from "@/lib/drawing/shapes"
import type { DrawingShape } from "@/types/db"

describe("toCsv", () => {
  it("adds a BOM, quotes special cells and formats money", () => {
    const csv = toCsv(["name", "amount"], [["a,b", 12.5], ['say "hi"', 0]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).split("\r\n")).toEqual(["name,amount", '"a,b",12.500', '"say ""hi""",0.000'])
  })
  it("neutralizes spreadsheet formulas but keeps negative numbers", () => {
    const csv = toCsv(["x"], [["=HYPERLINK(1)"], ["@cmd"], [-5]])
    expect(csv.slice(1).split("\r\n").slice(1)).toEqual(["'=HYPERLINK(1)", "'@cmd", "-5.000"])
  })
})

describe("resolveRange", () => {
  afterEach(() => vi.useRealTimers())
  // 2026-10-07 is a Wednesday (noon, clinic time zone safe).
  const at = () => vi.useFakeTimers({ now: new Date("2026-10-07T09:00:00Z"), toFake: ["Date"] })

  it("defaults to today and handles yesterday", () => {
    at()
    expect(resolveRange({})).toEqual({ key: "today", from: "2026-10-07", to: "2026-10-07" })
    expect(resolveRange({ range: "yesterday" })).toEqual({ key: "yesterday", from: "2026-10-06", to: "2026-10-06" })
  })
  it("starts the week on Saturday and the month on day 1", () => {
    at()
    expect(resolveRange({ range: "week" })).toMatchObject({ from: "2026-10-03", to: "2026-10-07" })
    expect(resolveRange({ range: "month" })).toMatchObject({ from: "2026-10-01", to: "2026-10-07" })
  })
  it("validates and orders custom ranges", () => {
    at()
    expect(resolveRange({ range: "custom", from: "2026-09-10", to: "2026-09-01" })).toEqual({ key: "custom", from: "2026-09-01", to: "2026-09-10" })
    expect(resolveRange({ range: "custom", from: "bad'; drop" })).toEqual({ key: "custom", from: "2026-10-07", to: "2026-10-07" })
  })
})

describe("drawing hit test (object eraser)", () => {
  const base = { id: "s", color: "#000", size: 4 }
  it("normalizes boxes drawn backwards", () => {
    expect(box({ x: 10, y: 10, w: -5, h: -4 })).toEqual({ x: 5, y: 6, w: 5, h: 4 })
  })
  it("hits strokes and lines near the path only", () => {
    const pen: DrawingShape = { ...base, type: "pen", points: [0, 0, 100, 0] }
    expect(hitTest(pen, 50, 2, 3)).toBe(true)
    expect(hitTest(pen, 50, 30, 3)).toBe(false)
    const arrow: DrawingShape = { ...base, type: "arrow", points: [0, 0, 0, 100] }
    expect(hitTest(arrow, 1, 60, 3)).toBe(true)
    expect(hitTest(arrow, 20, 60, 3)).toBe(false)
  })
  it("hits rectangle and ellipse outlines, not their empty interior", () => {
    const rect: DrawingShape = { ...base, type: "rect", x: 0, y: 0, w: 100, h: 50 }
    expect(hitTest(rect, 0, 25, 3)).toBe(true)
    expect(hitTest(rect, 50, 25, 3)).toBe(false)
    const circle: DrawingShape = { ...base, type: "circle", x: 0, y: 0, w: 100, h: 100 }
    expect(hitTest(circle, 100, 50, 3)).toBe(true)
    expect(hitTest(circle, 50, 50, 3)).toBe(false)
  })
  it("hits text inside its bounding box", () => {
    const text: DrawingShape = { ...base, type: "text", x: 10, y: 10, text: "cyst", size: 20 }
    expect(hitTest(text, 20, 20, 2)).toBe(true)
    expect(hitTest(text, 200, 20, 2)).toBe(false)
  })
})
