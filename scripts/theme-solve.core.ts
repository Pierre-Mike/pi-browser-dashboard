/**
 * The contrast solver behind a theme family — PURE.
 *
 * This technique has been written from scratch three times (once for
 * `candy`/`arcade`/`citrus`, once for `prism`, once for `neon`) and thrown away
 * three times, and each rewrite re-derived the same two sentences:
 *
 *   1. A vivid hue cannot be ink on a near-white surface at full lightness —
 *      hot pink #ec4899 is 3.19:1, lime #84cc16 is 2.11:1, yellow #facc15 is
 *      1.68:1 — and the reflex fix, desaturating until it passes, produces
 *      exactly the muted palette a pop family exists not to be.
 *   2. So **drop lightness, never saturation**: for each hue, take the value at
 *      near-maximum chroma *closest to* L=0.5 that still clears the floor.
 *      Saturation is what the eye reads as pop; lightness is what the gate reads.
 *
 * `L = 0.5` is the maximum-chroma point at `S = 1`, and contrast against a fixed
 * background is monotone in lightness on either side of it, so "closest to 0.5
 * that clears the floor" is a bisection. That is the whole solver.
 *
 * Two things this file is deliberate about, both of which cost a family a
 * screenshot round-trip when they were got wrong:
 *
 * - **The floor is against that variant's own `base-100`, never against white.**
 *   `neon` proved it matters in the direction nobody expects: on its electric
 *   lemon page (`#f5ff00`, luminance 0.147 under the WCAG curve for its darkest
 *   channel pair) the floor is *harder* than on white, not easier, so a hue
 *   solved against `#ffffff` ships one step too light.
 * - **The pane is between `base-100` and `base-200`, so it is a stricter
 *   background than `base-100` for light ink.** Anything that has to be legible
 *   in the terminal (the cursor, every ANSI ink slot) is solved against the pane,
 *   not against the page.
 *
 * Pure by shape (`*.core.ts`): hues and a shape tuple in, hexes and measurements
 * out. No file I/O, no `console`, no failure by exception — an unreachable floor
 * comes back as `meets: false` on a measurement and `scripts/scaffold-theme.ts`
 * refuses to write.
 */

export type Rgb = readonly [number, number, number]

// ── colour maths ────────────────────────────────────────────────────────────
//
// The same six lines the four theme gates each carry, because a dependency for
// WCAG 2.1 relative luminance is not worth it and this file has to agree with
// them exactly — if the solver's arithmetic drifted from the gate's, every hex it
// emits would be a coin flip.

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const toByte = (unit: number): number => Math.round(clamp01(unit) * 255)

const pad2 = (byte: number): string => byte.toString(16).padStart(2, "0")

const hexOf = (input: { readonly rgb: Rgb }): string =>
  `#${input.rgb.map((channel) => pad2(Math.round(clamp01(channel / 255) * 255))).join("")}`

export const rgbOf = (input: { readonly hex: string }): Rgb => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(input.hex.slice(i, i + 2), 16))
  return [r, g, b]
}

/**
 * HSL to hex, in the branch-free CSS Color 4 formulation.
 *
 * The textbook six-way sector switch is the same arithmetic with a cyclomatic
 * complexity of seven; `fallow audit` grades complexity on changed files, and a
 * helper this small should not be the reason a theme PR fails the audit.
 */
export const hslHex = (input: {
  readonly h: number
  readonly s: number
  readonly l: number
}): string => {
  const amp = clamp01(input.s) * Math.min(clamp01(input.l), 1 - clamp01(input.l))
  const at = (n: number): number => {
    const k = (n + (((input.h % 360) + 360) % 360) / 30) % 12
    return clamp01(input.l) - amp * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return hexOf({ rgb: [toByte(at(0)), toByte(at(8)), toByte(at(4))] })
}

const linear = (raw: number): number =>
  raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4

export const luminance = (input: { readonly hex: string }): number => {
  const [r, g, b] = rgbOf({ hex: input.hex }).map((channel) => linear(channel / 255))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

export const contrast = (input: { readonly a: string; readonly b: string }): number => {
  const la = luminance({ hex: input.a })
  const lb = luminance({ hex: input.b })
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Channel spread — 0 for any gray, 255 for a fully saturated hue. */
export const spread = (input: { readonly hex: string }): number => {
  const channels = rgbOf({ hex: input.hex })
  return Math.max(...channels) - Math.min(...channels)
}

/**
 * The per-channel midpoint of two colours.
 *
 * This is how the xterm pane is derived, and it satisfies `terminalTheme.test.ts`'s
 * "pane between `base-100` and `base-200` on every channel" rule by construction
 * rather than by luck — the rule that a palette copied from `pid` into another
 * family fails on all three channels at once.
 */
export const midpoint = (input: { readonly a: string; readonly b: string }): string => {
  const one = rgbOf({ hex: input.a })
  const two = rgbOf({ hex: input.b })
  return hexOf({
    rgb: [
      Math.round((one[0] + two[0]) / 2),
      Math.round((one[1] + two[1]) / 2),
      Math.round((one[2] + two[2]) / 2),
    ],
  })
}

// ── the solver ──────────────────────────────────────────────────────────────

/** One contrast obligation: this colour, against that background, at this ratio. */
export type Floor = { readonly against: string; readonly ratio: number }

export type Solved = {
  readonly hex: string
  /** The lightness it landed on — the input to the next step of a bright ramp. */
  readonly l: number
  readonly meets: boolean
}

export type Direction = "darker" | "lighter"

/** S=1, L=0.5 is the most chromatic point in the HSL cylinder. Start there. */
const MAX_CHROMA_L = 0.5

// 28 halvings of a 0.5-wide interval lands well inside one 8-bit step, so the
// bisection is exact at output precision.
const BISECT_STEPS = 28

const meetsAll = (input: { readonly hex: string; readonly floors: readonly Floor[] }): boolean =>
  input.floors.every((floor) => contrast({ a: input.hex, b: floor.against }) >= floor.ratio)

/**
 * Bisect the lightness axis for the feasible value nearest `bounds[0]`.
 *
 * `bounds` is `[infeasible, feasible]`, and only ever narrows toward the
 * feasible side — `good` is re-verified on every accepted step, so the value
 * returned satisfies the floors even where 8-bit rounding makes the predicate
 * slightly non-monotone.
 */
const bisect = (input: {
  readonly ok: (l: number) => boolean
  readonly bounds: readonly [number, number]
}): number => {
  let bad = input.bounds[0]
  let good = input.bounds[1]
  for (let step = 0; step < BISECT_STEPS; step += 1) {
    const mid = (bad + good) / 2
    if (input.ok(mid)) good = mid
    else bad = mid
  }
  return good
}

/**
 * The lightest (on light surfaces) or darkest (on dark ones) value at this hue
 * and saturation that clears every floor — i.e. the one closest to maximum
 * chroma that is still legible.
 *
 * `meets: false` means the floor is unreachable at this hue and saturation even
 * at the extreme; the caller reports it and refuses rather than shipping it.
 */
export const solveInk = (input: {
  readonly hue: number
  readonly saturation: number
  readonly direction: Direction
  readonly floors: readonly Floor[]
}): Solved => {
  const at = (l: number): string => hslHex({ h: input.hue, s: input.saturation, l })
  const ok = (l: number): boolean => meetsAll({ hex: at(l), floors: input.floors })
  const extreme = input.direction === "darker" ? 0 : 1
  const l = ok(MAX_CHROMA_L)
    ? MAX_CHROMA_L
    : ok(extreme)
      ? bisect({ ok, bounds: [MAX_CHROMA_L, extreme] })
      : extreme
  return { hex: at(l), l, meets: ok(l) }
}

/**
 * The "bright" half of an ANSI ramp: the same hue, a step lighter, still legible.
 *
 * A step *lighter* in both variants, which is not symmetric and is the point. On
 * a dark pane lighter means more contrast, so the step is free. On a light pane
 * lighter means *less* contrast, so the step is bounded by the 3:1 ink floor and
 * `bisect` finds how far it can go — which is exactly how `pidlight` ends up with
 * `yellow #a16207` under `brightYellow #b67c04`.
 *
 * Deriving bright from base's lightness rather than from a second, looser floor
 * is deliberate: with two floors, a hue whose L=0.5 value already clears both
 * (every yellow, green and cyan on a near-black pane) solves to the *same* hex
 * twice, and a palette whose bright half equals its base half has silently lost
 * eight slots.
 */
export const stepLighter = (input: {
  readonly base: Solved
  readonly hue: number
  readonly saturation: number
  readonly delta: number
  readonly floors: readonly Floor[]
}): Solved => {
  const at = (l: number): string => hslHex({ h: input.hue, s: input.saturation, l })
  const target = Math.min(0.97, input.base.l + input.delta)
  const ok = (l: number): boolean => meetsAll({ hex: at(l), floors: input.floors })
  const l = ok(target) ? target : bisect({ ok, bounds: [target, input.base.l] })
  return { hex: at(l), l, meets: ok(l) }
}

// ── the family ──────────────────────────────────────────────────────────────

/**
 * The seven tokens the app paints as ink (`text-<token>`), in the order a
 * seven-long `--hues` list maps onto them. Six hues is legal too — see
 * `SIX_HUE_ROLES` — and aliases `success` to `accent`, which is the pattern
 * `prismlight` already uses (both green) and `pidlight` uses for
 * `warning`/`accent`.
 */
export const INK_ROLES = [
  "primary",
  "secondary",
  "accent",
  "info",
  "success",
  "warning",
  "error",
] as const

type InkRole = (typeof INK_ROLES)[number]

export const SHAPE_KEYS = [
  "--radius-box",
  "--radius-field",
  "--radius-selector",
  "--border",
  "--depth",
] as const

export type ShapeTuple = Readonly<Record<(typeof SHAPE_KEYS)[number], string>>

export type FamilySpec = {
  readonly id: string
  readonly label: string
  /** 6 or 7 hue angles, mapped onto INK_ROLES in order. */
  readonly hues: readonly number[]
  readonly shape: ShapeTuple
}

export type Measurement = {
  readonly what: string
  readonly hex: string
  readonly against: string
  readonly ratio: number
  readonly floor: number
  readonly ok: boolean
}

type Variant = "light" | "dark"

export type ThemeTokens = Readonly<Record<string, string>>
export type TerminalPalette = Readonly<Record<string, string>>

/** The three always-painted surfaces, named rather than indexed. */
type Surfaces = {
  readonly base100: string
  readonly base200: string
  readonly base300: string
}

export type SolvedVariant = {
  readonly name: string
  readonly tokens: ThemeTokens
  readonly palette: TerminalPalette
  readonly measurements: readonly Measurement[]
}

export type SolvedFamily = {
  readonly spec: FamilySpec
  readonly light: SolvedVariant
  readonly dark: SolvedVariant
  readonly measurements: readonly Measurement[]
  readonly failures: readonly Measurement[]
}

// The two surface ramps. One hue at three (saturation, lightness) points, which
// is what `candy` / `arcade` / `citrus` each do: `#fff7fb` -> `#ffdff1` ->
// `#ffc2e0` is one pink getting less pale. Chroma rises as the surface deepens,
// because only `base-content`'s 7:1 constrains these and there is ~10:1 of
// headroom — a near-gray step is a wasted budget on ~75% of the painted pixels.
type Stop = { readonly s: number; readonly l: number }

const RAMPS: Readonly<Record<Variant, Readonly<Record<keyof Surfaces, Stop>>>> = {
  light: {
    base100: { s: 1, l: 0.975 },
    base200: { s: 1, l: 0.925 },
    base300: { s: 1, l: 0.855 },
  },
  dark: {
    base100: { s: 0.72, l: 0.068 },
    base200: { s: 0.68, l: 0.105 },
    base300: { s: 0.6, l: 0.165 },
  },
}

const DIRECTION: Readonly<Record<Variant, Direction>> = { light: "darker", dark: "lighter" }

/** `base-content` at 7:1 on all three surfaces; ink at 4.5:1 on `base-100`. */
const BASE_CONTENT_FLOOR = 7
const INK_FLOOR = 4.5
/** WCAG's non-text bar. ANSI slots are decoration and 13px glyphs at once. */
const ANSI_FLOOR = 3
/** What the *base* half of each ANSI ramp is solved at, so bright has room. */
const ANSI_BASE_FLOOR: Readonly<Record<Variant, number>> = { light: 3.8, dark: 4.2 }
const BRIGHT_DELTA: Readonly<Record<Variant, number>> = { light: 0.1, dark: 0.16 }

// Ink saturation. Below 1 so the solved value has somewhere to go before the
// gamut edge clips a channel, which is what turns a "fully saturated" hue into a
// different hue.
const INK_SATURATION = 0.94
const BASE_CONTENT_SATURATION: Readonly<Record<Variant, number>> = { light: 0.72, dark: 0.3 }
const NEUTRAL: Readonly<Record<Variant, Stop>> = {
  light: { s: 0.62, l: 0.17 },
  dark: { s: 0.56, l: 0.2 },
}

// The neutral ANSI ramp, per variant, as a table rather than as a run of
// `light ? … : …` ternaries. Same values, one decision point instead of five.
const NEUTRAL_RAMP: Readonly<
  Record<
    Variant,
    {
      readonly dimSaturation: number
      readonly dimFloor: number
      readonly whiteSaturation: number
      readonly whiteFloor: number
      readonly brightDelta: number
    }
  >
> = {
  // On light paper the whole ramp is dark, `white` included — xterm's #ffffff
  // default is invisible there — so the floors are what keep the three steps
  // apart: `brightBlack` darkest at 5.2, `white` at 3.6, `brightWhite` a step
  // lighter still and bounded only by the 3:1 ink floor.
  light: {
    dimSaturation: 0.22,
    dimFloor: 5.2,
    whiteSaturation: 0.12,
    whiteFloor: 3.6,
    brightDelta: 0.1,
  },
  // On a dark pane the ordering inverts: `brightBlack` is the dimmest slot that
  // still clears 3:1, and `white` is genuinely light at 8:1.
  dark: {
    dimSaturation: 0.35,
    dimFloor: 3.2,
    whiteSaturation: 0.3,
    whiteFloor: 8,
    brightDelta: 0.09,
  },
}

/**
 * The six hues ANSI already names, kept canonical.
 *
 * A family's character lives in its pane colour, its neutral ramp and which
 * lightness each slot lands on — not in moving `red` off red. `mono`'s rule
 * ("desaturate, don't erase: a build failure that no longer reads as an error is
 * a worse regression than a palette that is slightly too colourful") is the
 * general form of that, and it applies to hue even harder than to chroma.
 */
const ANSI_HUES = [
  { slot: "red", hue: 2 },
  { slot: "green", hue: 142 },
  { slot: "yellow", hue: 45 },
  { slot: "blue", hue: 212 },
  { slot: "magenta", hue: 310 },
  { slot: "cyan", hue: 186 },
] as const

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

const measure = (input: {
  readonly what: string
  readonly hex: string
  readonly floor: Floor
}): Measurement => {
  const ratio = contrast({ a: input.hex, b: input.floor.against })
  return {
    what: input.what,
    hex: input.hex,
    against: input.floor.against,
    ratio,
    floor: input.floor.ratio,
    ok: ratio >= input.floor.ratio,
  }
}

/**
 * Six hues fill these roles, and `success` borrows `accent`'s.
 *
 * `success` rather than any other role because that is the alias the repo
 * already ships: `prismlight` gives `accent` and `success` the same green,
 * having run out of distinct hues at seven tokens and six references.
 */
const SIX_HUE_ROLES: readonly InkRole[] = [
  "primary",
  "secondary",
  "accent",
  "info",
  "warning",
  "error",
]

const hueFor = (input: { readonly hues: readonly number[]; readonly role: InkRole }): number => {
  const order = input.hues.length === SIX_HUE_ROLES.length ? SIX_HUE_ROLES : INK_ROLES
  const accent = input.hues[order.indexOf("accent")] ?? 0
  // `indexOf` returns -1 for a role this list does not fill (only `success`, and
  // only for a six-hue family), and `hues[-1]` is `undefined`, so the fallback
  // covers both cases without a second branch.
  return input.hues[order.indexOf(input.role)] ?? accent
}

const surfacesFor = (input: { readonly hue: number; readonly variant: Variant }): Surfaces => {
  const ramp = RAMPS[input.variant]
  const at = (stop: Stop): string => hslHex({ h: input.hue, s: stop.s, l: stop.l })
  return { base100: at(ramp.base100), base200: at(ramp.base200), base300: at(ramp.base300) }
}

const surfaceFloors = (input: { readonly surfaces: Surfaces }): readonly Floor[] =>
  [input.surfaces.base100, input.surfaces.base200, input.surfaces.base300].map((against) => ({
    against,
    ratio: BASE_CONTENT_FLOOR,
  }))

const inksFor = (input: {
  readonly spec: FamilySpec
  readonly variant: Variant
  /** Per-role, because only `primary` also has to be legible in the xterm pane. */
  readonly floorsFor: (role: InkRole) => readonly Floor[]
}): Readonly<Record<InkRole, Solved>> => {
  // Written out rather than built from `Object.fromEntries` so the return type is
  // total by construction: a map lookup needs seven `??` fallbacks, and seven
  // fallbacks for a case that cannot happen is seven branches the complexity
  // budget pays for.
  const ink = (role: InkRole): Solved =>
    solveInk({
      hue: hueFor({ hues: input.spec.hues, role }),
      saturation: INK_SATURATION,
      direction: DIRECTION[input.variant],
      floors: input.floorsFor(role),
    })
  return {
    primary: ink("primary"),
    secondary: ink("secondary"),
    accent: ink("accent"),
    info: ink("info"),
    success: ink("success"),
    warning: ink("warning"),
    error: ink("error"),
  }
}

/** Only `primary` also has to clear the pane: the xterm cursor *is* the primary. */
const inkFloors = (input: {
  readonly role: InkRole
  readonly page: Floor
  readonly pane: Floor
}): readonly Floor[] => (input.role === "primary" ? [input.page, input.pane] : [input.page])

/**
 * ANSI `black` is a background slot, so it is the darkest thing each variant has:
 * `base-content` on light paper (which is also `pidlight`'s and `citruslight`'s
 * choice) and `base-300` on a dark pane (`candydark`'s and `arcadedark`'s). Both
 * differ from the pane, which is all the gate asks of it.
 */
const ansiBlack = (input: {
  readonly variant: Variant
  readonly baseContent: string
  readonly surfaces: Surfaces
}): string => (input.variant === "light" ? input.baseContent : input.surfaces.base300)

/** One ANSI hue slot plus its bright twin, both against the pane. */
const ansiPair = (input: {
  readonly hue: number
  readonly variant: Variant
  readonly pane: string
}): readonly [Solved, Solved] => {
  const base = solveInk({
    hue: input.hue,
    saturation: 0.95,
    direction: DIRECTION[input.variant],
    floors: [{ against: input.pane, ratio: ANSI_BASE_FLOOR[input.variant] }],
  })
  const bright = stepLighter({
    base,
    hue: input.hue,
    saturation: 0.95,
    delta: BRIGHT_DELTA[input.variant],
    floors: [{ against: input.pane, ratio: ANSI_FLOOR }],
  })
  return [base, bright]
}

/**
 * The neutral ramp: `white` / `brightWhite` / `brightBlack`, tinted with the
 * family hue rather than left as a stock gray.
 *
 * `white` and `brightWhite` are **grays in the light variant** and that is
 * mandatory, not stylistic: xterm's defaults (`white #ffffff`,
 * `brightWhite #ffffff`) assume a dark background and are invisible on light
 * paper. Every light palette in the repo overrides all sixteen slots for this
 * reason; `piddark` is the one theme allowed to declare none.
 */
const neutralRamp = (input: {
  readonly hue: number
  readonly variant: Variant
  readonly pane: string
}): Readonly<Record<string, Solved>> => {
  const ramp = NEUTRAL_RAMP[input.variant]
  const dim = solveInk({
    hue: input.hue,
    saturation: ramp.dimSaturation,
    direction: DIRECTION[input.variant],
    floors: [{ against: input.pane, ratio: ramp.dimFloor }],
  })
  const white = solveInk({
    hue: input.hue,
    saturation: ramp.whiteSaturation,
    direction: DIRECTION[input.variant],
    floors: [{ against: input.pane, ratio: ramp.whiteFloor }],
  })
  const brightWhite = stepLighter({
    base: white,
    hue: input.hue,
    saturation: ramp.whiteSaturation,
    delta: ramp.brightDelta,
    floors: [{ against: input.pane, ratio: ANSI_FLOOR }],
  })
  return { brightBlack: dim, white, brightWhite }
}

const paletteOf = (input: {
  readonly hue: number
  readonly variant: Variant
  readonly pane: string
  readonly foreground: string
  readonly cursor: string
  readonly black: string
}): TerminalPalette => {
  const neutrals = neutralRamp({ hue: input.hue, variant: input.variant, pane: input.pane })
  const hues = ANSI_HUES.flatMap(({ slot, hue }) => {
    const [base, bright] = ansiPair({ hue, variant: input.variant, pane: input.pane })
    return [
      [slot, base.hex],
      [`bright${capitalise(slot)}`, bright.hex],
    ]
  })
  return {
    background: input.pane,
    foreground: input.foreground,
    cursor: input.cursor,
    black: input.black,
    ...Object.fromEntries(hues),
    ...Object.fromEntries(Object.entries(neutrals).map(([slot, solved]) => [slot, solved.hex])),
  }
}

// Slots measured against the pane at a floor of their own. Everything else in a
// palette is an ANSI slot at 3:1, and `background` (the pane itself) and `black`
// (a background slot, 1:1 against any dark pane by xterm's own default) are not
// measured at all.
const PANE_FLOORS: Readonly<Record<string, number>> = { foreground: 4.5, cursor: ANSI_FLOOR }
const UNMEASURED = new Set(["background", "black"])

const slotLabel = (input: { readonly name: string; readonly slot: string }): string =>
  PANE_FLOORS[input.slot] === undefined
    ? `${input.name} ansi.${input.slot}`
    : `${input.name} pane ${input.slot}`

const paletteMeasurements = (input: {
  readonly name: string
  readonly palette: TerminalPalette
}): readonly Measurement[] => {
  const pane = input.palette.background ?? "#000000"
  return Object.entries(input.palette)
    .filter(([slot]) => !UNMEASURED.has(slot))
    .map(([slot, hex]) =>
      measure({
        what: slotLabel({ name: input.name, slot }),
        hex,
        floor: { against: pane, ratio: PANE_FLOORS[slot] ?? ANSI_FLOOR },
      }),
    )
}

const solveVariant = (input: {
  readonly spec: FamilySpec
  readonly variant: Variant
}): SolvedVariant => {
  const name = `${input.spec.id}${input.variant}`
  const hue = input.spec.hues[0] ?? 0
  const surfaces = surfacesFor({ hue, variant: input.variant })
  const base100 = surfaces.base100
  const pane = midpoint({ a: base100, b: surfaces.base200 })
  const baseContent = solveInk({
    hue,
    saturation: BASE_CONTENT_SATURATION[input.variant],
    direction: DIRECTION[input.variant],
    floors: surfaceFloors({ surfaces }),
  })
  const paneFloor: Floor = { against: pane, ratio: ANSI_FLOOR }
  const pageFloor: Floor = { against: base100, ratio: INK_FLOOR }
  const inks = inksFor({
    spec: input.spec,
    variant: input.variant,
    floorsFor: (role) => inkFloors({ role, page: pageFloor, pane: paneFloor }),
  })
  const tokens: ThemeTokens = {
    name,
    "color-scheme": input.variant,
    "--color-primary": inks.primary.hex,
    // `primary-content` is `base-100`, and that is *guaranteed* rather than
    // solved: contrast is symmetric, and `primary` was just solved to clear
    // 4.5:1 against `base-100`, so `base-100` clears 4.5:1 on `primary` by the
    // same number. Six of the repo's themes already do this by hand.
    "--color-primary-content": base100,
    "--color-secondary": inks.secondary.hex,
    "--color-accent": inks.accent.hex,
    "--color-neutral": hslHex({ h: hue, ...NEUTRAL[input.variant] }),
    "--color-base-100": base100,
    "--color-base-200": surfaces.base200,
    "--color-base-300": surfaces.base300,
    "--color-base-content": baseContent.hex,
    "--color-info": inks.info.hex,
    "--color-success": inks.success.hex,
    "--color-warning": inks.warning.hex,
    "--color-error": inks.error.hex,
    ...input.spec.shape,
    "--noise": "0",
  }
  const palette = paletteOf({
    hue,
    variant: input.variant,
    pane,
    foreground: baseContent.hex,
    cursor: inks.primary.hex,
    black: ansiBlack({ variant: input.variant, baseContent: baseContent.hex, surfaces }),
  })
  const measurements: readonly Measurement[] = [
    ...surfaceFloors({ surfaces }).map((floor) =>
      measure({ what: `${name} base-content`, hex: baseContent.hex, floor }),
    ),
    measure({
      what: `${name} primary-content`,
      hex: base100,
      floor: { against: inks.primary.hex, ratio: INK_FLOOR },
    }),
    ...INK_ROLES.map((role) =>
      measure({ what: `${name} text-${role}`, hex: inks[role].hex, floor: pageFloor }),
    ),
    ...paletteMeasurements({ name, palette }),
  ]
  return { name, tokens, palette, measurements }
}

export const solveFamily = (input: { readonly spec: FamilySpec }): SolvedFamily => {
  const light = solveVariant({ spec: input.spec, variant: "light" })
  const dark = solveVariant({ spec: input.spec, variant: "dark" })
  const measurements = [...light.measurements, ...dark.measurements]
  return {
    spec: input.spec,
    light,
    dark,
    measurements,
    failures: measurements.filter((m) => !m.ok),
  }
}

// ── shape uniqueness ────────────────────────────────────────────────────────

/**
 * `themeCatalog.test.ts` requires the shape rows to be distinct as whole tuples
 * — a family shaped like an existing one is colour-only again, which is the
 * state tokenised shape replaced. Detecting the collision here means the
 * generator refuses instead of emitting something that fails the gate.
 */
export const shapeKey = (input: { readonly shape: ShapeTuple }): string =>
  SHAPE_KEYS.map((key) => `${key}=${input.shape[key]}`).join(" ")

export const shapeCollision = (input: {
  readonly existing: ReadonlyArray<{ readonly name: string; readonly shape: ShapeTuple }>
  readonly shape: ShapeTuple
}): string | null => {
  const key = shapeKey({ shape: input.shape })
  return input.existing.find((row) => shapeKey({ shape: row.shape }) === key)?.name ?? null
}

// ── input parsing ───────────────────────────────────────────────────────────

export type Parsed<T> = { readonly value: T } | { readonly error: string }

export const parseHues = (input: { readonly raw: string }): Parsed<readonly number[]> => {
  const parts = input.raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
  const hues = parts.map((part) => Number(part))
  if (hues.length < 6 || hues.length > 7) {
    return {
      error: `--hues wants 6 or 7 angles mapped onto ${INK_ROLES.join("/")}, got ${hues.length}`,
    }
  }
  const bad = hues.filter((hue) => !Number.isFinite(hue) || hue < 0 || hue >= 360)
  if (bad.length > 0) return { error: `--hues must be angles in [0,360), got ${bad.join(", ")}` }
  return { value: hues }
}

export const parseShape = (input: { readonly raw: string }): Parsed<ShapeTuple> => {
  const parts = input.raw.split(",").map((part) => part.trim())
  if (parts.length !== SHAPE_KEYS.length) {
    return { error: `--shape wants ${SHAPE_KEYS.length} values: ${SHAPE_KEYS.join(",")}` }
  }
  const empty = parts.filter((part) => part === "")
  if (empty.length > 0) return { error: "--shape has an empty value" }
  return {
    value: Object.fromEntries(SHAPE_KEYS.map((key, i) => [key, parts[i] ?? ""])) as ShapeTuple,
  }
}

/**
 * Hues whose role has a conventional band — a `success` that is not green, an
 * `error` that is not red — reported as advice, never as a refusal.
 *
 * `prism` deliberately puts orange-red in `error` and green in `accent`, so this
 * cannot be a gate. It exists because the mapping is positional and a rotated
 * `--hues` list is an easy mistake to make and a hard one to see in a swatch.
 */
const HUE_BANDS: ReadonlyArray<{
  readonly role: InkRole
  readonly band: readonly [number, number]
  readonly reads: string
}> = [
  { role: "success", band: [80, 175], reads: "green" },
  { role: "warning", band: [20, 70], reads: "amber" },
  { role: "error", band: [335, 25], reads: "red" },
  { role: "info", band: [170, 255], reads: "blue or cyan" },
]

const inBand = (input: {
  readonly hue: number
  readonly band: readonly [number, number]
}): boolean => {
  const [lo, hi] = input.band
  return lo <= hi ? input.hue >= lo && input.hue <= hi : input.hue >= lo || input.hue <= hi
}

export const hueWarnings = (input: { readonly hues: readonly number[] }): readonly string[] =>
  HUE_BANDS.filter(
    ({ role, band }) => !inBand({ hue: hueFor({ hues: input.hues, role }), band }),
  ).map(
    ({ role, band, reads }) =>
      `${role} is hue ${hueFor({ hues: input.hues, role })}, outside the ${band[0]}..${band[1]} band a ${reads} ${role} usually sits in — a status colour carries meaning, so check this is what you meant`,
  )
