import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { THEME_FAMILIES } from "../../lib/ui/theme.core"
import { terminalTheme } from "./terminalTheme"

// The xterm pane is the largest surface in the app and the only one daisyUI
// cannot reach: xterm paints its own canvas from hex values, so no semantic
// token reaches inside it. The palette is therefore keyed by *daisyUI theme
// name* — eight themes, eight palettes — and this file is what keeps each one
// inside its family instead of falling back to pid's slate/sky pair. That
// fallback was the defect: `terminaldark` wrapped a slate-blue terminal in a
// phosphor-green shell and `sunsetdark` put a cool navy pane inside warm plum
// chrome, which reads as a hole in the page rather than a panel.

const THEME_NAMES = THEME_FAMILIES.flatMap((family) => [family.light, family.dark])

const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const

// ANSI `black` is a *background* slot by convention — xterm's own default is
// #000000, which is 1:1 against any dark pane — so it is checked for being
// distinguishable from the pane, not for contrast against it. Every other slot
// carries text.
const INK_KEYS = ANSI_KEYS.filter((key) => key !== "black")

const FOREGROUND_FLOOR = 4.5
// WCAG's non-text / large-text bar. ANSI slots are decoration and 13px glyphs
// at once; 4.5 is unreachable for a "bright" slot on a light pane, and 2 (the
// bar this test used when there was one light palette) passes colours that are
// merely visible rather than legible.
const ANSI_FLOOR = 3

// `pid` is byte-frozen: it is the default, both of its backgrounds are asserted
// by the e2e suite, and the point of keying the palette by theme name was to
// make the OTHER families expressible, not to restyle this one. Two of its light
// slots predate this gate and miss the floor, so they are exempted by name with
// the measured ratio recorded — the same pattern themeCatalog.test.ts uses for
// pidlight's primary — rather than lowering the bar for every family added
// after it.
const ANSI_CONTRAST_EXEMPT = new Set([
  "pidlight.brightYellow", // #ca8a04 on #f8fafc — 2.81:1
  // A light theme's "bright white" is a gray by construction (white on white is
  // invisible); slate-400 is as dark as it can go and still read as the bright
  // end of the ramp.
  "pidlight.brightWhite", // #94a3b8 on #f8fafc — 2.45:1
])

// piddark declares no ANSI slots at all: xterm's defaults already assume a dark
// background, and the frozen palette shipped without them. Every other theme
// must declare all sixteen — mandatory for a light pane, where the defaults
// (brightYellow #ffff55, white #ffffff) vanish, and deliberate for a dark one,
// where the point is that the slots belong to the family.
const ANSI_OPTIONAL = new Set(["piddark"])

const rgb = (hex: string): readonly number[] =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))

const channel = (raw: number): number =>
  raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4

const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = rgb(hex).map((v) => channel(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// WCAG 2.1 contrast ratio between two hex colours.
const contrast = ({ a, b }: { readonly a: string; readonly b: string }): number => {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const spread = (hex: string): number => Math.max(...rgb(hex)) - Math.min(...rgb(hex))

const at = (hex: string): { readonly r: number; readonly g: number; readonly b: number } => {
  const [r = 0, g = 0, b = 0] = rgb(hex)
  return { r, g, b }
}

// The config is loaded through a computed specifier for the same reason
// themeCatalog.test.ts does it: tsc never has to resolve a .js module
// (apps/web has no allowJs), and the runtime value is what matters.
const CONFIG_PATH = join(import.meta.dir, "..", "..", "..", "tailwind.config.js")

const loadThemes = async (): Promise<Readonly<Record<string, Record<string, string>>>> => {
  const mod = await import(CONFIG_PATH)
  const themes: Record<string, Record<string, string>> = {}
  for (const entry of mod.default.daisyui.themes) {
    for (const [name, tokens] of Object.entries(entry)) {
      themes[name] = tokens as Record<string, string>
    }
  }
  return themes
}

describe("every theme gets its own terminal palette", () => {
  it("resolves a palette for all eight catalogued themes", () => {
    for (const name of THEME_NAMES) {
      const palette = terminalTheme({ theme: name })
      for (const slot of ["background", "foreground", "cursor"] as const) {
        expect(palette[slot], `${name}.${slot}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it("gives each theme a background of its own — no family falls back to pid's", () => {
    const backgrounds = THEME_NAMES.map((name) => terminalTheme({ theme: name }).background)
    expect(new Set(backgrounds).size, `duplicate pane colours: ${backgrounds.join(" ")}`).toBe(
      THEME_NAMES.length,
    )
  })

  it("still paints an unrecognised theme name, by its light/dark suffix", () => {
    // A theme id nobody recognises must produce a usable pane rather than an
    // undefined palette — the same total-fallback rule theme.core.ts applies to
    // the family itself.
    expect(terminalTheme({ theme: "vaporwave" })).toEqual(terminalTheme({ theme: "pidlight" }))
    expect(terminalTheme({ theme: "vaporwavedark" })).toEqual(terminalTheme({ theme: "piddark" }))
  })
})

describe("pid's palette is byte-frozen", () => {
  // The two backgrounds below are asserted verbatim by
  // apps/e2e/tests/terminal-light-mode.spec.ts and theme-switch.spec.ts. Freeze
  // the whole object, not just the background: pid is the default, and the
  // per-family work must be visible as a change to the OTHER seven palettes.
  it("keeps piddark exactly as it shipped", () => {
    expect(terminalTheme({ theme: "piddark" })).toEqual({
      background: "#0b1220",
      foreground: "#e2e8f0",
      cursor: "#38bdf8",
    })
  })

  it("keeps pidlight exactly as it shipped", () => {
    expect(terminalTheme({ theme: "pidlight" })).toEqual({
      background: "#f8fafc",
      foreground: "#0f172a",
      cursor: "#0284c7",
      black: "#0f172a",
      red: "#dc2626",
      green: "#15803d",
      yellow: "#a16207",
      blue: "#1d4ed8",
      magenta: "#7e22ce",
      cyan: "#0e7490",
      white: "#64748b",
      brightBlack: "#475569",
      brightRed: "#ef4444",
      brightGreen: "#16a34a",
      brightYellow: "#ca8a04",
      brightBlue: "#2563eb",
      brightMagenta: "#9333ea",
      brightCyan: "#0891b2",
      brightWhite: "#94a3b8",
    })
  })
})

describe("every palette is legible", () => {
  it("clears 4.5:1 between foreground and background", () => {
    for (const name of THEME_NAMES) {
      const { foreground, background } = terminalTheme({ theme: name })
      const ratio = contrast({ a: foreground, b: background })
      expect(
        ratio,
        `${name}: foreground on background is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(FOREGROUND_FLOOR)
    }
  })

  it("clears 3:1 between cursor and background", () => {
    for (const name of THEME_NAMES) {
      const { cursor, background } = terminalTheme({ theme: name })
      const ratio = contrast({ a: cursor, b: background })
      expect(
        ratio,
        `${name}: cursor on background is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(ANSI_FLOOR)
    }
  })

  it("declares all sixteen ANSI slots, so no slot inherits an xterm default", () => {
    for (const name of THEME_NAMES) {
      if (ANSI_OPTIONAL.has(name)) continue
      const palette = terminalTheme({ theme: name })
      for (const key of ANSI_KEYS) {
        expect(palette[key], `${name} leaves ${key} to xterm's default`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it("clears 3:1 on every ANSI ink slot against its own background", () => {
    for (const name of THEME_NAMES) {
      const palette = terminalTheme({ theme: name })
      for (const key of INK_KEYS) {
        const colour = palette[key]
        if (colour === undefined) continue
        if (ANSI_CONTRAST_EXEMPT.has(`${name}.${key}`)) continue
        const ratio = contrast({ a: colour, b: palette.background })
        expect(
          ratio,
          `${name}.${key} (${colour}) on ${palette.background} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(ANSI_FLOOR)
      }
    }
  })

  it("keeps ANSI black distinguishable from the pane it sits on", () => {
    for (const name of THEME_NAMES) {
      const palette = terminalTheme({ theme: name })
      if (palette.black === undefined) continue
      expect(palette.black, `${name}: ANSI black is the pane colour`).not.toBe(palette.background)
    }
  })

  it("exempts nothing outside pid, and names every exemption it does grant", () => {
    // An exemption is a recorded decision about frozen hex, not a way to ship a
    // new palette that misses the floor.
    for (const entry of ANSI_CONTRAST_EXEMPT) expect(entry.startsWith("pidlight.")).toBe(true)
    for (const entry of ANSI_OPTIONAL) expect(entry).toBe("piddark")
  })
})

describe("each pane sits inside its family's chrome", () => {
  // This is the whole point of the change, and it is checkable rather than a
  // matter of taste: the pane colour must fall between the family's `base-100`
  // and `base-200` on every channel — the two surfaces the app shell gradient
  // paints around it. pid already satisfied this (#f8fafc is exactly halfway
  // between #ffffff and #f1f5f9), which is why its pane never looked wrong; a
  // palette copied from pid into another family fails on every channel at once.
  it("keeps every background between its theme's base-100 and base-200", async () => {
    const themes = await loadThemes()
    for (const name of THEME_NAMES) {
      const tokens = themes[name]
      if (!tokens) throw new Error(`tailwind.config.js has no theme ${name}`)
      const pane = at(terminalTheme({ theme: name }).background)
      const one = at(tokens["base-100"] as string)
      const two = at(tokens["base-200"] as string)
      for (const key of ["r", "g", "b"] as const) {
        const [lo, hi] = [Math.min(one[key], two[key]), Math.max(one[key], two[key])]
        expect(
          pane[key],
          `${name}: pane ${key}=${pane[key]} is outside base-100/base-200 (${lo}..${hi})`,
        ).toBeGreaterThanOrEqual(lo)
        expect(pane[key]).toBeLessThanOrEqual(hi)
      }
    }
  })

  it("paints the terminal family in phosphor green, blue slots included", () => {
    for (const name of ["terminallight", "terminaldark"]) {
      const palette = terminalTheme({ theme: name })
      const ink = at(palette.foreground)
      expect(ink.g, `${name}: ink is not green-dominant`).toBeGreaterThan(ink.r)
      expect(ink.g).toBeGreaterThan(ink.b)
      // A phosphor terminal has no blue in it. The slots that would be blue
      // lean teal/green instead, which is what makes the pane read as one
      // surface with the shell rather than as a stock palette dropped in.
      for (const key of ["blue", "brightBlue"] as const) {
        const slot = at(palette[key] as string)
        expect(slot.g, `${name}.${key} is bluer than it is green`).toBeGreaterThan(slot.b)
      }
    }
    // Only the dark variant's *pane* is green: the light one is a printout, so
    // its paper is warm (r > g > b) and the green lives in the ink.
    const crt = at(terminalTheme({ theme: "terminaldark" }).background)
    expect(crt.g, "terminaldark: pane is not green-dominant").toBeGreaterThan(crt.r)
    expect(crt.g).toBeGreaterThan(crt.b)
    const paper = at(terminalTheme({ theme: "terminallight" }).background)
    expect(paper.r, "terminallight: paper is not warm").toBeGreaterThan(paper.b)
  })

  it("keeps the mono family near-grayscale without erasing its ANSI hues", () => {
    for (const name of ["monolight", "monodark"]) {
      const palette = terminalTheme({ theme: name })
      for (const slot of ["background", "foreground"] as const) {
        expect(spread(palette[slot]), `${name}.${slot} is not near-grayscale`).toBeLessThanOrEqual(
          12,
        )
      }
      // Desaturate, don't erase: `red` still has to read as an error.
      const red = at(palette.red as string)
      expect(red.r - Math.max(red.g, red.b), `${name}.red no longer reads red`).toBeGreaterThan(32)
    }
  })

  it("keeps the sunset family warm where pid is cool", () => {
    for (const name of ["sunsetlight", "sunsetdark"]) {
      const pane = at(terminalTheme({ theme: name }).background)
      expect(pane.r, `${name}: pane is not warm`).toBeGreaterThan(pane.b)
    }
    // The contrast case: pid's pane is slate, and its blue channel dominates.
    const pid = at(terminalTheme({ theme: "piddark" }).background)
    expect(pid.b).toBeGreaterThan(pid.r)
  })
})
