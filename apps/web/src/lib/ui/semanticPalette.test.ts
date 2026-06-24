import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// Uniform design: feature UIs must paint with daisyUI semantic tokens
// (base-100/200/300, base-content, primary/secondary/accent, info/success/
// warning/error/neutral) — NOT the raw Tailwind palette (slate/gray/zinc/sky/
// rose/emerald/amber/indigo/…). Semantic tokens auto-adapt across the pidlight
// / piddark themes, so a single class replaces the hand-maintained
// `light dark:` pairs and the design stays uniform across every feature.
//
// This test is the ratchet that keeps it uniform: it scans every feature .tsx
// className surface for raw-palette utilities and fails on any it finds.

const FEATURES_DIR = join(import.meta.dir, "..", "..", "features")

// Files that legitimately carry literal colours that are DATA, not UI styling:
// xterm needs hex theme values; the Obsidian Canvas spec encodes node colours.
// These are allow-listed wholesale.
const ALLOWLISTED_FILES = new Set<string>([
  "terminal/terminalTheme.ts",
  "canvas/canvasObsidian.ts",
  "projects/canvasParse.ts",
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

const collectTsx = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectTsx(full))
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full)
    }
  }
  return out
}

const rel = (full: string) => full.slice(FEATURES_DIR.length + 1)

describe("feature UIs use daisyUI semantic tokens, not the raw Tailwind palette", () => {
  const files = collectTsx(FEATURES_DIR)

  it("scans a non-trivial number of feature components", () => {
    expect(files.length).toBeGreaterThan(20)
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
