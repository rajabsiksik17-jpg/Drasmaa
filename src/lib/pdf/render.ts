import "server-only"
import { existsSync } from "node:fs"
import type { Browser } from "puppeteer-core"

/**
 * Real PDF generation with headless Chromium (`page.pdf()`): text stays
 * selectable vector text, Cairo/Arabic shaping and RTL come from the same
 * browser engine that renders the clinic's paper forms, tables repeat
 * their header rows on every page and page breaks follow the print CSS.
 *
 * Chromium source, in order:
 *   1. CHROME_PATH (any Chrome/Chromium/Edge binary on the server)
 *   2. A locally installed Chrome / Edge (development machines)
 *   3. @sparticuz/chromium (self-contained Linux build for servers without Chrome)
 */

const LOCAL_BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]

let browserPromise: Promise<Browser> | null = null

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default
  const configured = process.env.CHROME_PATH
  const local = configured && existsSync(configured) ? configured : LOCAL_BROWSERS.find((p) => existsSync(p))
  const common = ["--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--font-render-hinting=none"]
  if (local) {
    return puppeteer.launch({ executablePath: local, headless: true, args: [...common, "--no-sandbox"] })
  }
  const chromium = (await import("@sparticuz/chromium")).default
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: true,
    args: [...chromium.args, ...common],
  })
}

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().then((b) => {
      b.on("disconnected", () => {
        browserPromise = null
      })
      return b
    })
    browserPromise.catch(() => {
      browserPromise = null
    })
  }
  return browserPromise
}

export interface RenderOptions {
  /** Absolute URL of the print view on this server. */
  url: string
  cookies: { name: string; value: string }[]
  orientation: "portrait" | "landscape"
  margins: { top: number; right: number; bottom: number; left: number }
  /** ASCII-only footer text (page numbers are appended). */
  footer: string
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function renderPdf(opts: RenderOptions): Promise<Buffer> {
  const b = await browser()
  const context = await b.createBrowserContext()
  try {
    const page = await context.newPage()
    const origin = new URL(opts.url).origin
    // Only this application may be loaded inside the renderer.
    await page.setRequestInterception(true)
    page.on("request", (req) => {
      const u = req.url()
      if (u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:")) void req.continue()
      else void req.abort()
    })
    await page.setCookie(...opts.cookies.map((c) => ({ ...c, url: origin, httpOnly: true, sameSite: "Lax" as const })))
    await page.emulateMediaType("print")
    await page.setViewport({ width: opts.orientation === "landscape" ? 1123 : 794, height: 1123, deviceScaleFactor: 2 })
    const response = await page.goto(opts.url, { waitUntil: "networkidle0", timeout: 60_000 })
    if (!response || !response.ok()) throw new Error(`render page responded ${response?.status() ?? "no response"}`)
    if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("render session was not accepted")
    await page.waitForFunction("window.__pdfReady === true", { timeout: 45_000 })

    const size = `A4 ${opts.orientation}`
    const m = opts.margins
    await page.addStyleTag({
      content: `@page { size: ${size}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
@page landscape { size: A4 landscape; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
thead { display: table-header-group; } tfoot { display: table-footer-group; }
tr, img, .print-avoid-break { break-inside: avoid; }`,
    })

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#555;padding:0 10mm;display:flex;justify-content:space-between;">
<span>${escapeHtml(opts.footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      timeout: 60_000,
    })
    return Buffer.from(pdf)
  } finally {
    await context.close().catch(() => {})
  }
}

/** Origin the renderer uses to reach this server (never the public URL). */
export function internalOrigin() {
  // `next dev` only serves its dev assets to localhost; production uses the loopback IP.
  const host = process.env.NODE_ENV === "development" ? "localhost" : "127.0.0.1"
  return (process.env.INTERNAL_APP_URL ?? `http://${host}:${process.env.PORT ?? 3000}`).replace(/\/+$/, "")
}
