import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { schemeForThemeName, THEME_FAMILIES } from "./theme.core"

// The catalog in theme.core.ts names daisyUI themes; tailwind.config.js defines
// them. Nothing in the type system connects the two — a renamed theme would
// silently resolve to a `data-theme` value with no CSS behind it and paint an
// unstyled page. This test is that connection, plus the contrast floor the whole
// exercise exists for: a family is only shippable if base-content is legible on
// every base surface in both variants.
//
// The config is imported through a computed specifier so tsc never has to
// resolve a .js module (apps/web has no allowJs) — the runtime value is what
// matters here.
const CONFIG_PATH = join(import.meta.dir, "..", "..", "..", "tailwind.config.js")

type Theme = Record<string, string>

const loadConfig = async () => {
  const mod = await import(CONFIG_PATH)
  const config = mod.default
  const themes: Record<string, Theme> = {}
  for (const entry of config.daisyui.themes) {
    for (const [name, tokens] of Object.entries(entry)) themes[name] = tokens as Theme
  }
  return { config, themes, order: Object.keys(themes) }
}

// WCAG 2.1 relative luminance / contrast ratio. Six lines beats a dependency,
// and it keeps this gate runnable in the same `bun test` pass as everything else.
const channel = (raw: number): number =>
  raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4

const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) =>
    channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = ({ a, b }: { readonly a: string; readonly b: string }): number => {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// Every token the two original themes carry. A new family that forgets one gets
// daisyUI's auto-generated guess instead of a designed value — usually readable,
// occasionally not, always a surprise.
const REQUIRED_TOKENS = [
  "primary",
  "primary-content",
  "secondary",
  "accent",
  "neutral",
  "base-100",
  "base-200",
  "base-300",
  "base-content",
  "info",
  "success",
  "warning",
  "error",
] as const

// Phase 0 holds shape constant across families so a palette regression is never
// mistaken for a radius one. Tokenizing radius per family is a later change —
// when it happens, this assertion is the thing to relax deliberately.
const SHAPE_TOKENS = [
  "--rounded-box",
  "--rounded-btn",
  "--rounded-badge",
  "--animation-btn",
] as const

// pidlight pairs slate-50 text with sky-500 (2.65:1). It predates this gate and
// is byte-frozen by design (its hex values are asserted by the terminal e2e and
// referenced across the design docs), so it is exempted by name rather than
// silently lowering the bar for every family added after it.
const PRIMARY_CONTRAST_EXEMPT = new Set(["pidlight"])

describe("tailwind.config.js matches the theme catalog", () => {
  test("every catalogued theme name is defined in the config, and vice versa", async () => {
    const { themes } = await loadConfig()
    const catalogued = THEME_FAMILIES.flatMap((f) => [f.light, f.dark]).sort()
    expect(Object.keys(themes).sort()).toEqual(catalogued)
  })

  test("pidlight and piddark stay first, in that order — they are the no-JS fallback", async () => {
    const { order, config } = await loadConfig()
    expect(order.slice(0, 2)).toEqual(["pidlight", "piddark"])
    expect(config.daisyui.darkTheme).toBe("piddark")
  })

  test("daisyUI still keeps its hands off the page background", async () => {
    const { config } = await loadConfig()
    // base:false is what lets routes/__root.tsx own the shell paint.
    expect(config.daisyui.base).toBe(false)
  })

  test("darkMode is driven by the resolved theme name, not by the media query", async () => {
    const { config } = await loadConfig()
    expect(config.darkMode).toEqual(["selector", '[data-theme$="dark"]'])
  })

  test("the darkMode selector matches exactly the dark variant of every family", async () => {
    const { themes } = await loadConfig()
    for (const name of Object.keys(themes)) {
      // [data-theme$="dark"] is a suffix test; schemeForThemeName is the same
      // test in TS. They must agree or the terminal and the CSS disagree.
      expect(schemeForThemeName({ theme: name })).toBe(name.endsWith("dark") ? "dark" : "light")
    }
  })
})

describe("every theme is complete and legible", () => {
  test("carries the full token set", async () => {
    const { themes } = await loadConfig()
    for (const [name, tokens] of Object.entries(themes)) {
      for (const token of REQUIRED_TOKENS) {
        expect(tokens[token], `${name} is missing ${token}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  test("shares one set of shape tokens across all families", async () => {
    const { themes } = await loadConfig()
    const shape = (tokens: Theme) => SHAPE_TOKENS.map((t) => `${t}=${tokens[t]}`).join(" ")
    const reference = shape(themes.pidlight as Theme)
    for (const [name, tokens] of Object.entries(themes)) {
      expect(shape(tokens), `${name} deviates on radius/animation`).toBe(reference)
    }
  })

  test("base-content clears 7:1 on every base surface", async () => {
    const { themes } = await loadConfig()
    for (const [name, tokens] of Object.entries(themes)) {
      for (const surface of ["base-100", "base-200", "base-300"] as const) {
        const ratio = contrast({
          a: tokens["base-content"] as string,
          b: tokens[surface] as string,
        })
        expect(
          ratio,
          `${name}: base-content on ${surface} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThan(7)
      }
    }
  })

  test("primary-content clears 4.5:1 on primary", async () => {
    const { themes } = await loadConfig()
    for (const [name, tokens] of Object.entries(themes)) {
      if (PRIMARY_CONTRAST_EXEMPT.has(name)) continue
      const ratio = contrast({
        a: tokens["primary-content"] as string,
        b: tokens.primary as string,
      })
      expect(ratio, `${name}: primary-content on primary is ${ratio.toFixed(2)}:1`).toBeGreaterThan(
        4.5,
      )
    }
  })
})
