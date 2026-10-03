"use client"

import { useEffect } from "react"
import { MotionConfig } from "motion/react"

declare global {
  interface Window {
    __pdfReady?: boolean
  }
}

/** PDF render mode: no animations (every element is printed in its final state). */
export function PdfRenderMode({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig transition={{ duration: 0 }} reducedMotion="always">
      {children}
      <PdfReady />
    </MotionConfig>
  )
}

/**
 * Tells the headless PDF renderer that the page is complete: fonts are
 * loaded and client-rendered parts (drawings, charts) have painted.
 */
function PdfReady() {
  useEffect(() => {
    let cancelled = false
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          setTimeout(() => {
            if (!cancelled) window.__pdfReady = true
          }, 300),
        ),
      )
    })
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
