export type ColorScheme = "light" | "dark"

// Mirrors @xterm/xterm's ITheme without importing the package: this module is
// pure (unit-testable under bun without a DOM) and xterm only ships types
// alongside its browser bundle.
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

const dark: TerminalTheme = {
  background: "#0b1220",
  foreground: "#e2e8f0",
  cursor: "#38bdf8",
}

// Slate/sky palette to match the app's Tailwind light mode. xterm's default
// ANSI colors assume a dark background (brightYellow #ffff55, white #ffffff),
// so every slot is overridden with a shade that holds contrast on slate-50.
// "white"/"brightWhite" render as grays for the same reason VS Code Light
// does it: white-on-light is invisible.
const light: TerminalTheme = {
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
}

export const terminalTheme = (scheme: ColorScheme): TerminalTheme =>
  scheme === "dark" ? dark : light

export const schemeForPrefersDark = (prefersDark: boolean): ColorScheme =>
  prefersDark ? "dark" : "light"
