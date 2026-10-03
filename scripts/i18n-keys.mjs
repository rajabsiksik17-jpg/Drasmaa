// Extracts translation keys referenced in src/ so tests can verify that
// every key exists in en.json and ar.json.
//   static:  t("some.key")            -> exact key
//   dynamic: t(`type.${x}`)            -> prefix "type." must exist as an object
// A file may declare the same variable name (e.g. `t`) for different
// namespaces in different components, so every call carries all candidate
// namespaces; it passes if the key exists in any of them.
// Usage: node scripts/i18n-keys.mjs
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..", "src")

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mts)$/.test(name)) out.push(p)
  }
  return out
}

/** @returns {{ file: string, namespaces: string[], key: string, dynamic: boolean }[]} */
export function extractKeys() {
  const refs = []
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8")
    const vars = new Map()
    const decl = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([\w.]+)"\s*\)/g
    for (const m of src.matchAll(decl)) vars.set(m[1], [...(vars.get(m[1]) ?? []), m[2]])
    for (const [name, ns] of promiseAllTranslations(src)) vars.set(name, [...(vars.get(name) ?? []), ns])
    for (const [v, namespaces] of vars) {
      const call = new RegExp(`(?<![\\w.])${v}(?:\\.has)?\\(\\s*("([^"]+)"|\`([^\`]+)\`)`, "g")
      for (const m of src.matchAll(call)) {
        if (m[2] !== undefined) refs.push({ file: path.relative(root, file), namespaces, key: m[2], dynamic: false })
        else if (m[3] !== undefined) refs.push({ file: path.relative(root, file), namespaces, key: m[3].split("${")[0], dynamic: true })
      }
    }
  }
  return refs
}

/**
 * `const [a, t, b] = await Promise.all([x(), getTranslations("ns"), y()])`
 * → [["t", "ns"]] (top-level array elements are matched by position).
 */
function promiseAllTranslations(src) {
  const out = []
  const head = /const\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[/g
  for (const m of src.matchAll(head)) {
    const names = m[1].split(",").map((n) => n.trim().split(/[\s:=]/)[0])
    const elements = []
    let depth = 0
    let current = ""
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const ch = src[i]
      if (depth === 0 && ch === "]") {
        elements.push(current)
        break
      }
      if ("([{".includes(ch)) depth++
      if (")]}".includes(ch)) depth--
      if (depth === 0 && ch === ",") {
        elements.push(current)
        current = ""
      } else current += ch
    }
    elements.forEach((el, i) => {
      const t = /^\s*(?:getTranslations|useTranslations)\(\s*"([\w.]+)"\s*\)\s*$/.exec(el)
      if (t && names[i] && /^\w+$/.test(names[i])) out.push([names[i], t[1]])
    })
  }
  return out
}

function lookup(messages, dotted) {
  return dotted.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), messages)
}

/** Returns human-readable problems for a messages object. */
export function missingKeys(messages) {
  const problems = []
  for (const r of extractKeys()) {
    const ok = r.namespaces.some((ns) => {
      const target = lookup(messages, r.dynamic ? `${ns}.${r.key.replace(/\.$/, "")}` : `${ns}.${r.key}`)
      return r.dynamic ? (r.key.endsWith(".") ? typeof target === "object" : true) : typeof target === "string"
    })
    if (!ok) problems.push(`${r.file}: ${r.namespaces.join("|")} -> ${r.key}${r.dynamic ? "*" : ""}`)
  }
  return [...new Set(problems)]
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  for (const locale of ["en", "ar"]) {
    const messages = JSON.parse(readFileSync(path.resolve(root, "..", "messages", `${locale}.json`), "utf8"))
    const problems = missingKeys(messages)
    console.log(`${locale}: ${problems.length} missing`)
    for (const p of problems) console.log("  ", p)
  }
}
