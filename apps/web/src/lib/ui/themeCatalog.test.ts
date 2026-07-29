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

// Shape is a family's property, not a constant. Phase 0 pinned all eight themes
// to one set of radii deliberately, so that a palette regression could never be
// mistaken for a radius one; this is the deliberate relaxation of that — but
// *not* a deletion. A family that loses or drifts its shape tokens is still a
// failure, it just fails against its own row rather than against pidlight's.
//
// The table is the design decision, in one place:
//   pid       — byte-frozen. It is the default, and the point of tokenizing
//               shape was to make the OTHER families expressible, not to
//               restyle this one. Do not touch these three numbers.
//   mono      — tight and technical.
//   terminal  — fully square, including a 0s button transition.
//   sunset    — soft, with fully-pill badges.
//
// Both variants of a family share one shape: light and dark are the same design
// in two lightings.
const SHAPE_BY_FAMILY = {
  pid: {
    "--rounded-box": "0.75rem",
    "--rounded-btn": "0.5rem",
    "--rounded-badge": "1rem",
    "--animation-btn": "0.2s",
  },
  mono: {
    "--rounded-box": "0.25rem",
    "--rounded-btn": "0.125rem",
    "--rounded-badge": "0.25rem",
    "--animation-btn": "0.1s",
  },
  terminal: {
    "--rounded-box": "0",
    "--rounded-btn": "0",
    "--rounded-badge": "0",
    "--animation-btn": "0s",
  },
  sunset: {
    "--rounded-box": "1rem",
    "--rounded-btn": "0.75rem",
    "--rounded-badge": "2rem",
    "--animation-btn": "0.3s",
  },
} as const

const SHAPE_TOKENS = Object.keys(SHAPE_BY_FAMILY.pid) as ReadonlyArray<
  keyof (typeof SHAPE_BY_FAMILY)["pid"]
>

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

  test("the radius scale aliases the theme vars, so corner utilities are themeable", async () => {
    // Without these three entries in Tailwind's own borderRadius scale, only
    // daisyUI's whole-element `.rounded-box` exists and `rounded-t-box` /
    // `rounded-tr-btn` silently do nothing — the class name is simply unknown,
    // so the element renders with square corners and no error anywhere.
    // semanticRadius.test.ts would still pass, because the class *name* is
    // spelled correctly. This is the test that notices.
    const { config } = await loadConfig()
    expect(config.theme.extend.borderRadius).toEqual({
      box: "var(--rounded-box, 1rem)",
      btn: "var(--rounded-btn, 0.5rem)",
      badge: "var(--rounded-badge, 1.9rem)",
    })
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

  test("carries the shape its family declares", async () => {
    const { themes } = await loadConfig()
    for (const family of THEME_FAMILIES) {
      const expected = SHAPE_BY_FAMILY[family.id as keyof typeof SHAPE_BY_FAMILY]
      expect(expected, `${family.id} has no row in SHAPE_BY_FAMILY`).toBeDefined()
      for (const name of [family.light, family.dark]) {
        for (const token of SHAPE_TOKENS) {
          expect((themes[name] as Theme)[token], `${name} deviates on ${token}`).toBe(
            expected[token],
          )
        }
      }
    }
  })

  test("every family is shaped, and no two families are shaped alike", async () => {
    // The whole point: picking a family changes the component form. If two
    // families resolved to the same radii, one of them would be colour-only
    // again — which is the state this replaced.
    const { themes } = await loadConfig()
    const shapes = THEME_FAMILIES.map((f) =>
      SHAPE_TOKENS.map((t) => `${t}=${(themes[f.light] as Theme)[t]}`).join(" "),
    )
    expect(new Set(shapes).size).toBe(THEME_FAMILIES.length)
  })

  test("a family's light and dark variants share one shape", async () => {
    const { themes } = await loadConfig()
    const shape = (name: string) =>
      SHAPE_TOKENS.map((t) => `${t}=${(themes[name] as Theme)[t]}`).join(" ")
    for (const family of THEME_FAMILIES) {
      expect(shape(family.dark), `${family.id} light/dark shapes disagree`).toBe(
        shape(family.light),
      )
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
