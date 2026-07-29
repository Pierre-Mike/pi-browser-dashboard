// The xterm palette, keyed by *daisyUI theme name* — one palette per theme, not
// one light/dark pair shared by every family.
//
// xterm paints its own canvas from hex values, so it is the one surface in the
// app a semantic token cannot reach: `bg-base-100` stops at the pane's border.
// Keying the palette by `ColorScheme` therefore made the terminal a foreign
// object inside every non-default family — `terminaldark` wrapped a slate-blue
// terminal in a phosphor-green shell, `sunsetdark` put a cool navy pane inside
// warm plum chrome — which read as a hole in the page rather than as a panel.
//
// The rule each palette follows, and `terminalTheme.test.ts` enforces: the pane
// background sits between its theme's `base-100` and `base-200`, the two
// surfaces the app shell gradient paints around it. Foreground clears 4.5:1 on
// it and every ANSI ink slot clears 3:1.
//
// This file is allow-listed wholesale by `lib/ui/semanticPalette.test.ts`: its
// literals are colour *data* for a canvas, not styling. It is also pure —
// unit-testable under bun with no DOM — which is why the palettes live here and
// not in the component.

// Mirrors @xterm/xterm's ITheme without importing the package: xterm only ships
// types alongside its browser bundle, and importing it would drag the DOM in.
export type TerminalTheme = {
  readonly background: string
  readonly foreground: string
  readonly cursor: string
  readonly black?: string
  readonly red?: string
  readonly green?: string
  readonly yellow?: string
  readonly blue?: string
  readonly magenta?: string
  readonly cyan?: string
  readonly white?: string
  readonly brightBlack?: string
  readonly brightRed?: string
  readonly brightGreen?: string
  readonly brightYellow?: string
  readonly brightBlue?: string
  readonly brightMagenta?: string
  readonly brightCyan?: string
  readonly brightWhite?: string
}

// ── pid (default) ───────────────────────────────────────────────────────────
//
// Both **backgrounds** are frozen — they are asserted verbatim by the e2e suite
// and they are what makes the pane sit inside the shell gradient. The rest of
// the family was frozen too while the seven newer palettes were built, so that a
// regression could never be blamed on the machinery; that freeze is over, and
// what it had been protecting was two ANSI slots that missed the 3:1 ink floor.
//
// `piddark` still declares no ANSI slots. Not because "this is what shipped" —
// that reason expired with the freeze — but because xterm's dark defaults are
// measurably fine on #0b1220 (the darkest ink slot is brightBlack #666666 at
// 3.26:1, then ANSI red #cd3131 at 3.64:1; every other slot is above 3.8) and
// declaring sixteen slate/sky replacements would repaint every character of the
// app's default dark terminal for no accessibility gain. It is a deferral with a
// number behind it, and `terminalTheme.test.ts` names it as the one exemption.
const pidDark: TerminalTheme = {
  background: "#0b1220",
  foreground: "#e2e8f0",
  cursor: "#38bdf8",
}

// Slate/sky, matching pidlight's chrome. xterm's default ANSI colours assume a
// dark background (brightYellow #ffff55, white #ffffff), so a light palette has
// to override *every* slot — "white"/"brightWhite" render as grays for the same
// reason VS Code Light does it: white-on-light is invisible.
const pidLight: TerminalTheme = {
  background: "#f8fafc",
  foreground: "#0f172a",
  // The cursor is the theme's `primary`, as it is in all seven other palettes.
  // pidlight was the lone exception — cursor sky-600 under a sky-500 primary,
  // because the primary was too light for the pane. With primary at sky-700 the
  // exception has no reason left, and the caret gains contrast (3.91 → 5.67).
  cursor: "#0369a1",
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
  // Not yellow-600 (#ca8a04, 2.81:1): darkened along the same hue (~41°) until
  // it clears the 3:1 ink floor, and still a clear step above `yellow` in
  // luminance so the bright half of the ramp stays a bright half.
  brightYellow: "#b67c04",
  brightBlue: "#2563eb",
  brightMagenta: "#9333ea",
  brightCyan: "#0891b2",
  // Not slate-400 (#94a3b8, 2.45:1). A light theme's "bright white" is a gray by
  // construction, and the counter-argument on record was that a gray clearing
  // 3:1 stops reading as the bright end of the ramp. The repo's own three light
  // palettes refute it: mono ships #8e8e99 at 3.11, terminal #7e8878 at 3.28,
  // sunset #9e7d84 at 3.41, each still visibly lighter than its `white`. This is
  // the same move on the slate ramp — halfway to slate-500, 3.27:1, and still
  // ~1.5× the luminance of `white` #64748b.
  brightWhite: "#7c8ca2",
}

// ── mono ────────────────────────────────────────────────────────────────────
//
// Near-grayscale ink on near-grayscale paper. The ANSI slots are desaturated,
// not erased: a hue pulled all the way to gray takes `red` with it, and a build
// failure that no longer reads as an error is a worse regression than a palette
// that is slightly too colourful for the family.
const monoLight: TerminalTheme = {
  background: "#fafafa",
  foreground: "#18181b",
  cursor: "#3f3f46",
  black: "#18181b",
  red: "#a13c3c",
  green: "#4d6b33",
  yellow: "#6f5a1f",
  blue: "#3c5878",
  magenta: "#66436e",
  cyan: "#2f6060",
  white: "#71717a",
  brightBlack: "#52525b",
  brightRed: "#c25555",
  brightGreen: "#6b8f4d",
  brightYellow: "#8f7530",
  brightBlue: "#56749a",
  brightMagenta: "#8a5f92",
  brightCyan: "#3f8080",
  // Not zinc-400: on paper this bright end has to stay under ~55% lightness or
  // it stops clearing 3:1. Bright white is a gray in every light palette.
  brightWhite: "#8e8e99",
}

const monoDark: TerminalTheme = {
  background: "#101013",
  foreground: "#e4e4e7",
  cursor: "#d4d4d8",
  black: "#27272a",
  red: "#e08d8d",
  green: "#a3bf8c",
  yellow: "#d8c48c",
  blue: "#93a9c8",
  magenta: "#c0a4c8",
  cyan: "#9cc4c0",
  white: "#d4d4d8",
  brightBlack: "#71717a",
  brightRed: "#f2b3b3",
  brightGreen: "#c4dcae",
  brightYellow: "#ece2b4",
  brightBlue: "#b8cae0",
  brightMagenta: "#dcc6e2",
  brightCyan: "#bfdedb",
  brightWhite: "#f4f4f5",
}

// ── terminal ────────────────────────────────────────────────────────────────
//
// Phosphor green: dark green ink on warm paper (a printout), green on
// near-black (the CRT). The slots that would be blue lean teal instead — a
// phosphor tube has no blue in it, and a stock blue is exactly what made the old
// shared palette look bolted on.
const terminalLight: TerminalTheme = {
  background: "#f7f1e0",
  foreground: "#14351f",
  cursor: "#15803d",
  black: "#0d2413",
  red: "#a3301f",
  green: "#15803d",
  yellow: "#8a6100",
  blue: "#115e59",
  magenta: "#7c3f66",
  cyan: "#0f766e",
  white: "#6a7a63",
  brightBlack: "#3f5c46",
  brightRed: "#c2452c",
  brightGreen: "#1a9c4a",
  brightYellow: "#a67c00",
  brightBlue: "#0d8f86",
  brightMagenta: "#9b4f86",
  brightCyan: "#0e968c",
  brightWhite: "#7e8878",
}

const terminalDark: TerminalTheme = {
  background: "#061a0e",
  foreground: "#b8f5cd",
  cursor: "#4ade80",
  black: "#0d2b16",
  red: "#fca5a5",
  green: "#4ade80",
  yellow: "#fde047",
  blue: "#5eead4",
  magenta: "#d7a8e6",
  cyan: "#2dd4bf",
  // The neutral ramp is phosphor, not gray: plain output and green output are
  // the same colour on a real tube.
  white: "#86efac",
  brightBlack: "#46855b",
  brightRed: "#fecaca",
  brightGreen: "#86efac",
  brightYellow: "#fef08a",
  brightBlue: "#99f6e4",
  brightMagenta: "#eec6f5",
  brightCyan: "#ccfbf1",
  brightWhite: "#dcfce7",
}

// ── sunset ──────────────────────────────────────────────────────────────────
//
// Warm throughout: the pane carries the family's rose/orange tint, so it sits
// inside the chrome instead of punching a cool rectangle through it. Reds and
// ambers are the family's own; the cool slots are pulled toward the violet
// secondary rather than to a stock blue.
const sunsetLight: TerminalTheme = {
  background: "#fef5ee",
  foreground: "#3a1d24",
  cursor: "#e11d48",
  black: "#3a1d24",
  red: "#be123c",
  green: "#157f43",
  yellow: "#a85c11",
  blue: "#4338ca",
  magenta: "#a21caf",
  cyan: "#0e7490",
  white: "#8c6e74",
  brightBlack: "#6d4a52",
  brightRed: "#e11d48",
  brightGreen: "#16a34a",
  brightYellow: "#c2700f",
  brightBlue: "#5b50dd",
  brightMagenta: "#c026d3",
  brightCyan: "#0e96b2",
  brightWhite: "#9e7d84",
}

const sunsetDark: TerminalTheme = {
  background: "#1e121a",
  foreground: "#fbe3e0",
  cursor: "#fb7185",
  black: "#35202d",
  red: "#fda4af",
  green: "#6ee7b7",
  yellow: "#fcd34d",
  blue: "#a5b4fc",
  magenta: "#f0abfc",
  cyan: "#67e8f9",
  white: "#f2d6cf",
  brightBlack: "#8c6c78",
  brightRed: "#fecdd3",
  brightGreen: "#a7f3d0",
  brightYellow: "#fde68a",
  brightBlue: "#c7d2fe",
  brightMagenta: "#f5d0fe",
  brightCyan: "#a5f3fc",
  brightWhite: "#fff1ec",
}

// Keyed by the daisyUI theme names declared in tailwind.config.js and
// catalogued in lib/ui/theme.core.ts. A family added there without a palette
// here fails terminalTheme.test.ts rather than silently inheriting pid's.
const PALETTES: Readonly<Record<string, TerminalTheme>> = {
  pidlight: pidLight,
  piddark: pidDark,
  monolight: monoLight,
  monodark: monoDark,
  terminallight: terminalLight,
  terminaldark: terminalDark,
  sunsetlight: sunsetLight,
  sunsetdark: sunsetDark,
}

/**
 * The palette for a resolved daisyUI theme name (`<html data-theme>`).
 *
 * Total, like `theme.core.ts`'s own family lookup: an unrecognised name still
 * has to paint a usable pane, so it falls back to `pid` by the same `dark`
 * suffix the CSS `dark:` variant keys on.
 */
export const terminalTheme = ({ theme }: { readonly theme: string }): TerminalTheme =>
  PALETTES[theme] ?? (theme.endsWith("dark") ? pidDark : pidLight)
