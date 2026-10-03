// @vitest-environment jsdom
import { createElement, useState } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { useHydrated, useNow } from "@/hooks/use-hydration"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("useNow (regression: 'Maximum update depth exceeded' in NotificationBell)", () => {
  it("does not loop when components re-render and remount", async () => {
    // Real browsers take >= 1 ms per render, so Date.now() moves on every read.
    let fake = 1_000_000
    const spy = vi.spyOn(Date, "now").mockImplementation(() => ++fake)
    let renders = 0
    let rerender: () => void = () => {}
    function Clock() {
      renders++
      const now = useNow(60_000)
      const [, force] = useState(0)
      rerender = () => force((n) => n + 1)
      return createElement("span", null, now == null ? "server" : "client")
    }
    const container = document.createElement("div")
    const root = createRoot(container)
    await act(async () => root.render(createElement(Clock)))
    for (let i = 0; i < 5; i++) await act(async () => rerender())
    // Mount a second consumer (like opening the notifications popover).
    await act(async () => root.render(createElement("div", null, createElement(Clock), createElement(Clock))))
    await act(async () => new Promise((r) => setTimeout(r, 10)))
    expect(container.textContent).toContain("client")
    expect(renders).toBeLessThan(40)
    act(() => root.unmount())
    spy.mockRestore()
  })

  it("renders no wall-clock value on the server (deterministic HTML)", () => {
    function Probe() {
      const now = useNow()
      const hydrated = useHydrated()
      return createElement("span", null, `${now === null}-${hydrated}`)
    }
    expect(renderToString(createElement(Probe))).toBe("<span>true-false</span>")
  })
})
