import { describe, expect, it } from "bun:test"
import {
  contrast,
  type FamilySpec,
  hslHex,
  hueWarnings,
  INK_ROLES,
  luminance,
  midpoint,
  parseHues,
  parseShape,
  rgbOf,
  type ShapeTuple,
  type SolvedVariant,
  shapeCollision,
  shapeKey,
  solveFamily,
  solveInk,
  spread,
  stepLighter,
} from "./theme-solve.core"

// The generator is only worth committing if its output starts green, so this
// file re-states the floors the four theme gates enforce and asserts a *solved*
// family clears them — for adversarial hue sets, not just a convenient one.
//
// Yellow (60) and lime (90) are the two hues the repo has already learned cannot
// survive as light ink in recognisable form (`#886d03` bronze, `#4e7b09` olive),
// and pure blue (240) is the opposite problem: dark enough at full chroma that a
// naive solver leaves it identical to its own bright twin. All three are in here.

const SHAPE: ShapeTuple = {
  "--radius-box": "0.6875rem",
  "--radius-field": "0.1875rem",
  "--radius-selector": "0.8125rem",
  "--border": "5px",
  "--depth": "1",
}

const spec = (input: { readonly id: string; readonly hues: readonly number[] }): FamilySpec => ({
  id: input.id,
  label: `${input.id} — generated`,
  hues: input.hues,
  shape: SHAPE,
})

const HUE_SETS: ReadonlyArray<{ readonly id: string; readonly hues: readonly number[] }> = [
  // A conventional family: pink brand, cyan secondary, green/amber/red statuses.
  { id: "testpink", hues: [330, 190, 100, 205, 140, 40, 5] },
  // Yellow-first: the worst case for a light variant, because a yellow dark
  // enough to be ink has shed most of its chroma.
  { id: "testlemon", hues: [60, 200, 90, 190, 120, 45, 0] },
  // Lime-first, and lime again in `accent`.
  { id: "testlime", hues: [90, 250, 90, 200, 130, 35, 350] },
  // Pure blue: at S=1 L=0.5 it is dark enough to clear several floors at once.
  { id: "testblue", hues: [240, 300, 180, 210, 140, 40, 10] },
  // Six hues, so `success` has to alias `accent`.
  { id: "testsix", hues: [20, 280, 150, 195, 45, 355] },
]

describe("colour maths agrees with the gates", () => {
  it("round-trips a hex through rgb", () => {
    expect(rgbOf({ hex: "#0369a1" })).toEqual([3, 105, 161])
  })

  it("computes the ratios the theme gates report", () => {
    // Two numbers straight out of apps/web/CLAUDE.md: pid's repaired accent on
    // white, and the sky-600 value that was *not* enough.
    expect(contrast({ a: "#0369a1", b: "#ffffff" })).toBeCloseTo(5.93, 1)
    expect(contrast({ a: "#0284c7", b: "#ffffff" })).toBeCloseTo(4.1, 1)
  })

  it("puts maximum chroma at L=0.5", () => {
    expect(spread({ hex: hslHex({ h: 330, s: 1, l: 0.5 }) })).toBe(255)
    expect(spread({ hex: hslHex({ h: 330, s: 1, l: 0.5 }) })).toBeGreaterThan(
      spread({ hex: hslHex({ h: 330, s: 1, l: 0.9 }) }),
    )
  })

  it("midpoints per channel, which is how the pane lands inside the chrome", () => {
    // pid's real values: #f8fafc is exactly halfway between #ffffff and #f1f5f9.
    expect(midpoint({ a: "#ffffff", b: "#f1f5f9" })).toBe("#f8fafc")
  })
})

describe("solveInk drops lightness, never saturation", () => {
  const white = "#ffffff"

  it("returns the maximum-chroma value when it already clears the floor", () => {
    // Pure blue on white is 8.59:1 at L=0.5, so there is nothing to solve.
    const solved = solveInk({
      hue: 240,
      saturation: 1,
      direction: "darker",
      floors: [{ against: white, ratio: 4.5 }],
    })
    expect(solved.l).toBe(0.5)
    expect(solved.meets).toBe(true)
  })

  it("darkens a hue that cannot be ink at full lightness, and keeps its chroma", () => {
    // Hot pink is 3.19:1 on white; the answer has to be darker AND still pink.
    const solved = solveInk({
      hue: 330,
      saturation: 1,
      direction: "darker",
      floors: [{ against: white, ratio: 4.5 }],
    })
    expect(solved.meets).toBe(true)
    expect(solved.l).toBeLessThan(0.5)
    expect(contrast({ a: solved.hex, b: white })).toBeGreaterThanOrEqual(4.5)
    // The whole point: it is still a saturated pink, not a desaturated mauve.
    expect(spread({ hex: solved.hex })).toBeGreaterThan(150)
  })

  it("solves against the variant's own base-100, which can be harder than white", () => {
    // neon's finding. Electric lemon is a *darker* page than white by luminance,
    // so the same hue has to go further to clear the same floor on it.
    const lemon = "#f5ff00"
    expect(luminance({ hex: lemon })).toBeLessThan(luminance({ hex: "#ffffff" }))
    const onWhite = solveInk({
      hue: 330,
      saturation: 1,
      direction: "darker",
      floors: [{ against: "#ffffff", ratio: 4.5 }],
    })
    const onLemon = solveInk({
      hue: 330,
      saturation: 1,
      direction: "darker",
      floors: [{ against: lemon, ratio: 4.5 }],
    })
    expect(onLemon.l).toBeLessThan(onWhite.l)
    // …and the value solved against white would have missed on the lemon page.
    expect(contrast({ a: onWhite.hex, b: lemon })).toBeLessThan(4.5)
  })

  it("lightens instead on a dark background", () => {
    const solved = solveInk({
      hue: 330,
      saturation: 1,
      direction: "lighter",
      floors: [{ against: "#0a0118", ratio: 4.5 }],
    })
    expect(solved.meets).toBe(true)
    expect(contrast({ a: solved.hex, b: "#0a0118" })).toBeGreaterThanOrEqual(4.5)
  })

  it("clears the floor after 8-bit rounding, not merely in float space", () => {
    // A bisection that returns the boundary in float space and then rounds can
    // land one 8-bit step the wrong side of the floor. Every accepted step is
    // re-verified on the rounded hex instead.
    for (let hue = 0; hue < 360; hue += 7) {
      const solved = solveInk({
        hue,
        saturation: 0.94,
        direction: "darker",
        floors: [{ against: "#fffbf0", ratio: 4.5 }],
      })
      expect(solved.meets, `hue ${hue}: ${solved.hex}`).toBe(true)
      expect(contrast({ a: solved.hex, b: "#fffbf0" }), `hue ${hue}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("reports meets:false rather than throwing when a floor is unreachable", () => {
    // 21:1 is the whole dynamic range, so only pure black on pure white reaches
    // it — a saturated hue never can.
    const solved = solveInk({
      hue: 200,
      saturation: 1,
      direction: "darker",
      floors: [{ against: "#f0f0f0", ratio: 21 }],
    })
    expect(solved.meets).toBe(false)
  })
})

describe("stepLighter keeps a bright ramp bright", () => {
  it("moves away from a dark pane, where lighter costs nothing", () => {
    const pane = "#0b1018"
    const base = solveInk({
      hue: 45,
      saturation: 0.95,
      direction: "lighter",
      floors: [{ against: pane, ratio: 4.2 }],
    })
    const bright = stepLighter({
      base,
      hue: 45,
      saturation: 0.95,
      delta: 0.16,
      floors: [{ against: pane, ratio: 3 }],
    })
    expect(bright.hex).not.toBe(base.hex)
    expect(luminance({ hex: bright.hex })).toBeGreaterThan(luminance({ hex: base.hex }))
  })

  it("moves toward a light pane only as far as the 3:1 floor allows", () => {
    const pane = "#fff2cc"
    const base = solveInk({
      hue: 45,
      saturation: 0.95,
      direction: "darker",
      floors: [{ against: pane, ratio: 3.8 }],
    })
    const bright = stepLighter({
      base,
      hue: 45,
      saturation: 0.95,
      delta: 0.1,
      floors: [{ against: pane, ratio: 3 }],
    })
    expect(bright.hex).not.toBe(base.hex)
    expect(luminance({ hex: bright.hex })).toBeGreaterThan(luminance({ hex: base.hex }))
    expect(contrast({ a: bright.hex, b: pane })).toBeGreaterThanOrEqual(3)
  })
})

// ── the gates, restated ─────────────────────────────────────────────────────

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

const at = (hex: string) => {
  const [r = 0, g = 0, b = 0] = rgbOf({ hex })
  return { r, g, b }
}

// Total accessors, so the loops below carry no `??` of their own: every `??` is a
// branch, and `fallow audit` grades complexity on changed files.
const token = (input: { readonly variant: SolvedVariant; readonly name: string }): string =>
  input.variant.tokens[`--color-${input.name}`] ?? ""

const slot = (input: { readonly variant: SolvedVariant; readonly name: string }): string =>
  input.variant.palette[input.name] ?? ""

const INK_SLOTS = ANSI_KEYS.filter((key) => key !== "black")
const BASE_SURFACES = ["base-100", "base-200", "base-300"] as const
const HUE_SLOTS = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const

describe("a solved family clears every floor the theme gates enforce", () => {
  for (const set of HUE_SETS) {
    const family = solveFamily({ spec: spec(set) })
    const variants = [family.light, family.dark]

    it(`${set.id}: reports no failed measurement`, () => {
      expect(
        family.failures.map(
          (f) => `${f.what} on ${f.against} is ${f.ratio.toFixed(2)} < ${f.floor}`,
        ),
      ).toEqual([])
    })

    it(`${set.id}: every token is a lowercase six-digit hex`, () => {
      // themeCatalog.test.ts matches /^#[0-9a-f]{6}$/ on all thirteen.
      for (const variant of variants) {
        for (const [key, value] of Object.entries(variant.tokens)) {
          if (!key.startsWith("--color-")) continue
          expect(value, `${variant.name} ${key}`).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    })

    it(`${set.id}: base-content clears 7:1 on all three base surfaces`, () => {
      for (const variant of variants) {
        for (const role of BASE_SURFACES) {
          const ratio = contrast({
            a: token({ variant, name: "base-content" }),
            b: token({ variant, name: role }),
          })
          expect(ratio, `${variant.name} base-content on ${role}`).toBeGreaterThan(7)
        }
      }
    })

    it(`${set.id}: primary-content clears 4.5:1 on primary`, () => {
      for (const variant of variants) {
        const ratio = contrast({
          a: token({ variant, name: "primary-content" }),
          b: token({ variant, name: "primary" }),
        })
        expect(ratio, `${variant.name} primary-content on primary`).toBeGreaterThan(4.5)
      }
    })

    it(`${set.id}: every ink token clears 4.5:1 on its own base-100`, () => {
      for (const variant of variants) {
        for (const role of INK_ROLES) {
          const ratio = contrast({
            a: token({ variant, name: role }),
            b: token({ variant, name: "base-100" }),
          })
          expect(ratio, `${variant.name} text-${role}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${set.id}: declares all sixteen ANSI slots in both variants`, () => {
      for (const variant of variants) {
        for (const name of ANSI_KEYS) {
          expect(slot({ variant, name }), `${variant.name} ${name}`).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    })

    it(`${set.id}: every ANSI ink slot clears 3:1 on its own pane`, () => {
      for (const variant of variants) {
        for (const name of INK_SLOTS) {
          const ratio = contrast({
            a: slot({ variant, name }),
            b: slot({ variant, name: "background" }),
          })
          expect(ratio, `${variant.name}.${name}`).toBeGreaterThanOrEqual(3)
        }
      }
    })

    it(`${set.id}: no bright slot is a duplicate of its base slot`, () => {
      // The failure mode a two-floor solver produces silently: on a near-black
      // pane, yellow/green/cyan clear both floors at L=0.5 and the bright half of
      // the ramp becomes eight copies.
      for (const variant of variants) {
        for (const name of HUE_SLOTS) {
          const bright = `bright${name.charAt(0).toUpperCase()}${name.slice(1)}`
          expect(slot({ variant, name: bright }), `${variant.name}.${bright}`).not.toBe(
            slot({ variant, name }),
          )
        }
      }
    })

    it(`${set.id}: keeps ANSI black off the pane colour`, () => {
      for (const variant of variants) {
        expect(variant.palette.black).not.toBe(variant.palette.background)
      }
    })

    it(`${set.id}: paints the cursor in the theme's own primary`, () => {
      for (const variant of variants) {
        expect(variant.palette.cursor).toBe(variant.tokens["--color-primary"])
      }
    })

    it(`${set.id}: keeps each pane between its base-100 and base-200, per channel`, () => {
      for (const variant of variants) {
        const pane = at(slot({ variant, name: "background" }))
        const one = at(token({ variant, name: "base-100" }))
        const two = at(token({ variant, name: "base-200" }))
        for (const key of ["r", "g", "b"] as const) {
          const lo = Math.min(one[key], two[key])
          const hi = Math.max(one[key], two[key])
          expect(pane[key], `${variant.name} pane ${key}`).toBeGreaterThanOrEqual(lo)
          expect(pane[key]).toBeLessThanOrEqual(hi)
        }
      }
    })

    it(`${set.id}: declares the colour-scheme its name implies, and the shape it was given`, () => {
      expect(family.light.tokens["color-scheme"]).toBe("light")
      expect(family.dark.tokens["color-scheme"]).toBe("dark")
      expect(family.light.name).toBe(`${set.id}light`)
      expect(family.dark.name).toBe(`${set.id}dark`)
      for (const variant of variants) {
        expect(variant.tokens["--radius-box"]).toBe(SHAPE["--radius-box"])
        expect(variant.tokens["--border"]).toBe(SHAPE["--border"])
      }
    })

    it(`${set.id}: gives the two variants different panes and a light light variant`, () => {
      expect(family.light.palette.background).not.toBe(family.dark.palette.background)
      expect(
        luminance({ hex: token({ variant: family.light, name: "base-100" }) }),
      ).toBeGreaterThan(0.5)
      expect(luminance({ hex: token({ variant: family.dark, name: "base-100" }) })).toBeLessThan(
        0.1,
      )
    })

    it(`${set.id}: keeps its base surfaces tinted rather than gray`, () => {
      // A family whose chrome is a gray ramp is a colour-only family with an
      // accent, which is the mistake `prism` shipped once and was rejected for.
      for (const variant of variants) {
        expect(
          spread({ hex: token({ variant, name: "base-300" }) }),
          `${variant.name} base-300`,
        ).toBeGreaterThanOrEqual(8)
      }
    })
  }

  it("aliases success onto accent when given six hues", () => {
    const six = solveFamily({ spec: spec({ id: "testsix", hues: [20, 280, 150, 195, 45, 355] }) })
    expect(six.light.tokens["--color-success"]).toBe(six.light.tokens["--color-accent"])
  })
})

describe("shape uniqueness is detected, not discovered by the gate", () => {
  const other: ShapeTuple = { ...SHAPE, "--border": "1px" }

  it("names the family a duplicate tuple collides with", () => {
    expect(
      shapeCollision({ existing: [{ name: "citruslight", shape: SHAPE }], shape: { ...SHAPE } }),
    ).toBe("citruslight")
  })

  it("passes a tuple that differs in a single value", () => {
    expect(
      shapeCollision({ existing: [{ name: "citruslight", shape: SHAPE }], shape: other }),
    ).toBe(null)
  })

  it("keys on all five values, so two families cannot differ only in a comment", () => {
    expect(shapeKey({ shape: SHAPE })).toContain("--depth=1")
    expect(shapeKey({ shape: SHAPE })).not.toBe(shapeKey({ shape: other }))
  })
})

describe("input parsing fails as a value", () => {
  it("accepts six or seven hues", () => {
    expect(parseHues({ raw: "1,2,3,4,5,6" })).toEqual({ value: [1, 2, 3, 4, 5, 6] })
    expect(parseHues({ raw: " 1, 2,3,4,5,6,7 " })).toEqual({ value: [1, 2, 3, 4, 5, 6, 7] })
  })

  it("rejects the wrong count and out-of-range angles", () => {
    expect(parseHues({ raw: "1,2,3" })).toHaveProperty("error")
    expect(parseHues({ raw: "1,2,3,4,5,6,7,8" })).toHaveProperty("error")
    expect(parseHues({ raw: "1,2,3,4,5,400" })).toHaveProperty("error")
    expect(parseHues({ raw: "1,2,3,4,5,nope" })).toHaveProperty("error")
  })

  it("parses a five-value shape tuple in token order", () => {
    const parsed = parseShape({ raw: "1rem,0.5rem,2rem,3px,1" })
    expect(parsed).toEqual({
      value: {
        "--radius-box": "1rem",
        "--radius-field": "0.5rem",
        "--radius-selector": "2rem",
        "--border": "3px",
        "--depth": "1",
      },
    })
  })

  it("rejects a shape tuple of the wrong width", () => {
    expect(parseShape({ raw: "1rem,0.5rem,2rem" })).toHaveProperty("error")
    expect(parseShape({ raw: "1rem,0.5rem,2rem,3px," })).toHaveProperty("error")
  })
})

describe("hue advice", () => {
  it("says nothing about a conventional mapping", () => {
    expect(hueWarnings({ hues: [330, 190, 100, 205, 140, 40, 5] })).toEqual([])
  })

  it("flags a status hue that has lost its meaning", () => {
    // `success` at hue 330 is a pink "done" pill.
    const warnings = hueWarnings({ hues: [330, 190, 100, 205, 330, 40, 5] })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("success")
  })

  it("wraps the red band across 0", () => {
    expect(hueWarnings({ hues: [330, 190, 100, 205, 140, 40, 355] })).toEqual([])
    expect(hueWarnings({ hues: [330, 190, 100, 205, 140, 40, 5] })).toEqual([])
  })
})
