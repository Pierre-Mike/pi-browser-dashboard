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

// daisyUI 5 declares a theme as a flat object of CSS custom properties plus three
// meta keys (`name`, `default`, `prefersdark`, `color-scheme`). The config keeps
// that list as exported data — which is the whole reason this gate still has an
// input under a CSS-first Tailwind: `@config` loads the same module the bundler
// does, so there is exactly one declaration and this test reads it.
const META_KEYS = new Set(["name", "default", "prefersdark", "color-scheme"])

const loadConfig = async () => {
  const mod = await import(CONFIG_PATH)
  const config = mod.default
  const themes: Record<string, Theme> = {}
  const meta: Record<string, Record<string, unknown>> = {}
  for (const entry of mod.THEMES as ReadonlyArray<Record<string, string>>) {
    const name = entry.name as string
    themes[name] = Object.fromEntries(
      Object.entries(entry).filter(([key]) => !META_KEYS.has(key)),
    ) as Theme
    meta[name] = Object.fromEntries(Object.entries(entry).filter(([key]) => META_KEYS.has(key)))
  }
  return {
    config,
    themes,
    meta,
    daisyui: mod.DAISYUI_OPTIONS as Record<string, unknown>,
    order: Object.keys(themes),
  }
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

// daisyUI 5 prefixes every colour token with `--color-`. The short names stay the
// vocabulary of this file (and of the exemption list, and of the failure
// messages) — only the lookup changes.
const colour = ({ tokens, name }: { readonly tokens: Theme; readonly name: string }): string =>
  tokens[`--color-${name}`] as string

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
//   pid       — shape frozen. It is the default, and the point of tokenizing
//               shape was to make the OTHER families expressible, not to
//               restyle this one. Do not touch these three numbers. (Frozen
//               *tokens*, not frozen pixels: individual elements did move,
//               because the migration mapped each one by role — panel /
//               control / chip — and Tailwind's `rounded-lg` never equalled
//               `--rounded-btn`.) Its *colour* freeze is over — the accent had
//               to move to clear WCAG AA — but its geometry has no
//               accessibility argument pulling on it, so it stays put.
//   mono      — tight and technical.
//   terminal  — fully square, including a 0s button transition.
//   sunset    — soft, with fully-pill badges.
//
// Both variants of a family share one shape: light and dark are the same design
// in two lightings.
//
// daisyUI 5 note: `--animation-btn` is GONE — v5 hardcodes
// `transition-duration:.2s` on `.btn` and exposes no per-theme knob, so
// `terminal`'s deliberate `0s` ("a CRT does not ease") is no longer expressible.
// In its place v5 adds `--border` (read by 22 components) and `--depth` (14), so
// the shape row is still five values wide and still distinguishes every family.
const SHAPE_BY_FAMILY = {
  pid: {
    "--radius-box": "0.75rem",
    "--radius-field": "0.5rem",
    "--radius-selector": "1rem",
    "--border": "1px",
    "--depth": "0",
  },
  mono: {
    "--radius-box": "0.25rem",
    "--radius-field": "0.125rem",
    "--radius-selector": "0.25rem",
    "--border": "1px",
    "--depth": "0",
  },
  terminal: {
    "--radius-box": "0",
    "--radius-field": "0",
    "--radius-selector": "0",
    "--border": "2px",
    "--depth": "0",
  },
  sunset: {
    "--radius-box": "1rem",
    "--radius-field": "0.75rem",
    "--radius-selector": "2rem",
    "--border": "1px",
    "--depth": "1",
  },
} as const

const SHAPE_TOKENS = Object.keys(SHAPE_BY_FAMILY.pid) as ReadonlyArray<
  keyof (typeof SHAPE_BY_FAMILY)["pid"]
>

// There is no primary-contrast exemption any more. `pidlight` used to be named
// here — slate-50 on sky-500, 2.65:1 — because `pid` was held byte-frozen while
// the seven newer themes were built. Every one of those seven cleared the bar,
// which left the machine-wide *default* as the only theme that did not, so the
// accent was darkened to sky-700 and the exemption deleted. Both directions are
// asserted below, because `primary` is read both ways.

// Tokens the app paints as **ink** with `text-<token>`, and must therefore be
// legible on the page the shell paints. `base-100` is the top of the shell
// gradient; the deeper surfaces are not asserted because `sunsetlight` sits at
// 4.14 on `base-200`, and widening the bar to the whole gradient is a change to
// three families rather than a floor they already meet.
const INK_TOKENS = [
  "primary",
  "secondary",
  "accent",
  "info",
  "success",
  "warning",
  "error",
] as const

// Measured misses, deliberately deferred — not "frozen hex", which is no longer
// true of anything in this repo. `pidlight`'s three *status* hues carry meaning
// (a "blocked" pill has to read differently from a "failed" one at a glance in
// the sidebar), so darkening them changes what the app communicates and wants
// its own reviewable before/after rather than riding along on an accent fix.
// `sunsetlight.accent` is that family's own call, with a single `text-accent`
// site behind it. Every ratio below is measured, and the list is a ratchet: it
// cannot grow without someone writing the number down.
const INK_CONTRAST_EXEMPT = new Set([
  "pidlight.accent", // #f59e0b amber-500 on #ffffff — 2.15:1 (also `warning`)
  "pidlight.warning", // #f59e0b amber-500 on #ffffff — 2.15:1
  "pidlight.success", // #10b981 emerald-500 on #ffffff — 2.54:1
  "pidlight.error", // #f43f5e rose-500 on #ffffff — 3.67:1
  "sunsetlight.accent", // #ea580c orange-600 on #fffaf6 — 3.43:1
])

describe("tailwind.config.js matches the theme catalog", () => {
  test("every catalogued theme name is defined in the config, and vice versa", async () => {
    const { themes } = await loadConfig()
    const catalogued = THEME_FAMILIES.flatMap((f) => [f.light, f.dark]).sort()
    expect(Object.keys(themes).sort()).toEqual(catalogued)
  })

  test("pidlight is the default theme and piddark is the prefers-dark fallback", async () => {
    // Under daisyUI 4 this was positional and implicit: theme 0 became `:root`,
    // theme 1 got wrapped in `@media (prefers-color-scheme: dark)` because of the
    // `darkTheme` key, so the no-JS fallback depended on array order nobody
    // declared. daisyUI 5 makes both explicit per theme, which is strictly
    // better — the invariant is now stated where it takes effect, and it cannot
    // be broken by inserting a family at the top of the list.
    const { meta } = await loadConfig()
    expect(meta.pidlight?.default, "pidlight must carry `default: true`").toBe(true)
    expect(meta.piddark?.prefersdark, "piddark must carry `prefersdark: true`").toBe(true)
    // Exactly one of each, or the fallback is ambiguous.
    const defaults = Object.entries(meta).filter(([, m]) => m.default === true)
    const prefersdark = Object.entries(meta).filter(([, m]) => m.prefersdark === true)
    expect(defaults.map(([n]) => n)).toEqual(["pidlight"])
    expect(prefersdark.map(([n]) => n)).toEqual(["piddark"])
  })

  test("every theme declares the colour-scheme its name implies", async () => {
    // daisyUI 5 emits `color-scheme` into the theme rule, which is what makes
    // native form controls and scrollbars match. A light theme claiming `dark`
    // paints white-on-white checkboxes.
    const { meta } = await loadConfig()
    for (const [name, m] of Object.entries(meta)) {
      expect(m["color-scheme"], `${name} declares the wrong color-scheme`).toBe(
        name.endsWith("dark") ? "dark" : "light",
      )
    }
  })

  test("daisyUI still keeps its hands off the page background", async () => {
    const { daisyui } = await loadConfig()
    // daisyUI 5 replaced `base: false` with per-item excludes. `rootcolor` is the
    // one base item that paints :root's background/colour, so excluding it is
    // what lets routes/__root.tsx own the shell paint.
    expect(daisyui.exclude).toContain("rootcolor")
    // …and none of daisyUI's own 35 themes may ship, or `[data-theme=sunset]`
    // (a real built-in name!) would collide with this repo's `sunsetlight`.
    expect(daisyui.themes).toBe(false)
  })

  test("the radius scale aliases the theme vars, so corner utilities are themeable", async () => {
    // daisyUI 5 ships all 24 corner-specific forms for `box` / `field` /
    // `selector` itself, so those need no alias. It drops `btn` and `badge`,
    // which 126 call sites in this app are written against — without these two
    // entries every one of them becomes an unknown class that emits no CSS and
    // silently renders square. semanticRadius.test.ts would still pass, because
    // the class *name* is spelled correctly. This is the test that notices.
    const { config } = await loadConfig()
    expect(config.theme.extend.borderRadius).toEqual({
      btn: "var(--radius-field, 0.5rem)",
      badge: "var(--radius-selector, 1.9rem)",
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
        expect(colour({ tokens, name: token }), `${name} is missing ${token}`).toMatch(
          /^#[0-9a-f]{6}$/,
        )
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
          a: colour({ tokens, name: "base-content" }),
          b: colour({ tokens, name: surface }),
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
      const ratio = contrast({
        a: colour({ tokens, name: "primary-content" }),
        b: colour({ tokens, name: "primary" }),
      })
      expect(ratio, `${name}: primary-content on primary is ${ratio.toFixed(2)}:1`).toBeGreaterThan(
        4.5,
      )
    }
  })

  test("every ink token clears 4.5:1 on base-100", async () => {
    // The other half of the same token. `primary` is a *surface* under
    // primary-content in a button and *ink* via text-primary in a link, an
    // active tab, a focus ring and a count pill — 38 sites — so passing the
    // test above proves only that the button is readable. pidlight passed it by
    // exemption and failed this one at 2.77:1, which is how the default theme
    // ended up the least legible one shipped.
    const { themes } = await loadConfig()
    for (const [name, tokens] of Object.entries(themes)) {
      for (const token of INK_TOKENS) {
        if (INK_CONTRAST_EXEMPT.has(`${name}.${token}`)) continue
        const ratio = contrast({
          a: colour({ tokens, name: token }),
          b: colour({ tokens, name: "base-100" }),
        })
        expect(
          ratio,
          `${name}: text-${token} on base-100 is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("every ink exemption names a token that exists, and misses the bar", async () => {
    // A stale exemption is worse than none: it reads as a documented decision
    // while quietly covering nothing. So each entry has to still be a real
    // failure — the day one is repaid, this test says so and the line goes.
    const { themes } = await loadConfig()
    for (const entry of INK_CONTRAST_EXEMPT) {
      const [name = "", token = ""] = entry.split(".")
      const tokens = themes[name]
      expect(tokens, `${entry} names a theme that does not exist`).toBeDefined()
      const ratio = contrast({
        a: colour({ tokens: tokens as Theme, name: token }),
        b: colour({ tokens: tokens as Theme, name: "base-100" }),
      })
      expect(
        ratio,
        `${entry} now clears 4.5:1 (${ratio.toFixed(2)}) — delete the exemption`,
      ).toBeLessThan(4.5)
    }
  })
})
