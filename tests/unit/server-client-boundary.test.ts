import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// A server module importing a *value* (constant, helper) from a "use client"
// module only receives a client reference in production builds — e.g.
// `DAY_VIEWS.includes` then throws and the page fails. Components are fine.
const SRC = path.join(__dirname, "..", "..", "src")

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

const isClient = (p: string) => /^\s*["']use client["']/.test(readFileSync(p, "utf8"))
const resolve = (mod: string) => {
  if (!mod.startsWith("@/")) return null
  const base = path.join(SRC, mod.slice(2))
  return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((e) => base + e).find((c) => existsSync(c)) ?? null
}

describe("server / client boundary", () => {
  it("server modules import only components (not values) from client modules", () => {
    const problems: string[] = []
    for (const file of files(SRC)) {
      if (isClient(file)) continue
      const src = readFileSync(file, "utf8")
      for (const m of src.matchAll(/import\s+\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
        const target = resolve(m[2])
        if (!target || !isClient(target)) continue
        const values = m[1]
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("type "))
          .map((n) => n.split(/\s+as\s+/)[0])
          .filter((n) => !/^[A-Z][a-z]/.test(n))
        if (values.length) problems.push(`${path.relative(SRC, file)} <- ${m[2]}: ${values.join(", ")}`)
      }
    }
    expect(problems).toEqual([])
  })
})
