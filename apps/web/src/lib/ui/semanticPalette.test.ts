import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// Uniform design: the UI must paint with daisyUI semantic tokens
// (base-100/200/300, base-content, primary/secondary/accent, info/success/
// warning/error/neutral) — NOT the raw Tailwind palette (slate/gray/zinc/sky/
// rose/emerald/amber/indigo/…). Semantic tokens adapt across every theme
// *family* (see lib/ui/theme.core.ts), so a single class replaces the
// hand-maintained `light dark:` pairs and the design stays uniform.
//
// This is not cosmetic. A raw literal is a surface a theme cannot reach: the
// app shell was painted `from-slate-50 … dark:from-slate-950` and the sidebar
// `bg-white dark:bg-slate-950`, so picking a warm or a green family used to
// leave the two largest surfaces on the page untouched.
//
// This test is the ratchet that keeps it uniform: it scans the design surface
// for raw-palette utilities and fails on any it finds. `routes/` is in scope
// alongside `features/`, and `.ts` alongside `.tsx`, because the two worst
// offenders were a route file and a pure class-name helper — neither of which
// the original feature-.tsx-only scan could see.

const SRC_DIR = join(import.meta.dir, "..", "..")
const SCAN_ROOTS = ["features", "routes"] as const

// Files that legitimately carry literal colours that are DATA, not UI styling:
// xterm needs hex theme values; the Obsidian Canvas spec encodes node colours.
// These are allow-listed wholesale.
const ALLOWLISTED_FILES = new Set<string>([
  "features/terminal/terminalTheme.ts",
  "features/canvas/canvasObsidian.ts",
  "features/projects/canvasParse.ts",
])

// Raw Tailwind palette families that must not appear in a className context.
// Semantic equivalents: slate/gray/zinc/neutral/stone → base-*/neutral/
// base-content; sky/blue → primary or info; rose/red → error; emerald/green →
// success; amber/yellow/orange → warning; indigo/violet/purple → secondary.
const RAW_FAMILIES =
  "slate|gray|zinc|neutral|stone|sky|blue|rose|red|emerald|green|amber|yellow|orange|indigo|violet|purple|cyan|teal|fuchsia|pink|lime"
const RAW_UTIL = new RegExp(
  `\\b(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|divide|outline|decoration|placeholder|caret|accent|shadow)-(?:${RAW_FAMILIES})-\\d{2,3}\\b`,
  "g",
)

// A line may opt out with a trailing `design-allow:` comment naming the reason.
const ESCAPE_HATCH = /design-allow:/

const collectSources = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full))
    } else if (
      /\.tsx?$/.test(entry) &&
      !/\.test\.tsx?$/.test(entry) &&
      entry !== "routeTree.gen.ts"
    ) {
      out.push(full)
    }
  }
  return out
}

const rel = (full: string) => full.slice(SRC_DIR.length + 1)

describe("the UI uses daisyUI semantic tokens, not the raw Tailwind palette", () => {
  const files = SCAN_ROOTS.flatMap((root) => collectSources(join(SRC_DIR, root)))

  it("scans a non-trivial number of components", () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it("covers the app shell and the nav chrome, the two surfaces a theme must reach", () => {
    const scanned = files.map(rel)
    expect(scanned).toContain("routes/__root.tsx")
    expect(scanned).toContain("features/sessions/navChrome.ts")
  })

  for (const file of files) {
    const relPath = rel(file)
    if (ALLOWLISTED_FILES.has(relPath)) continue

    it(`${relPath} contains no raw-palette colour utilities`, () => {
      const lines = readFileSync(file, "utf8").split("\n")
      const offenders: string[] = []
      lines.forEach((line, i) => {
        if (ESCAPE_HATCH.test(line)) return
        const hits = line.match(RAW_UTIL)
        if (hits) offenders.push(`  L${i + 1}: ${hits.join(", ")}`)
      })
      expect(offenders, `${relPath} has raw-palette utilities:\n${offenders.join("\n")}`).toEqual(
        [],
      )
    })
  }
})
