import { describe, expect, it } from "bun:test"
import { schemeForPrefersDark, terminalTheme } from "./terminalTheme"

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

const channel = (hex: string, offset: number): number => {
  const v = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)

// WCAG contrast ratio between two hex colors.
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe("terminalTheme", () => {
  it("keeps the existing dark palette for the dark scheme", () => {
    const theme = terminalTheme("dark")
    expect(theme.background).toBe("#0b1220")
    expect(theme.foreground).toBe("#e2e8f0")
    expect(theme.cursor).toBe("#38bdf8")
  })

  it("returns a light palette for the light scheme", () => {
    const theme = terminalTheme("light")
    expect(theme.background).toBe("#f8fafc")
    expect(theme.foreground).toBe("#0f172a")
    expect(theme.cursor).toBe("#0284c7")
  })

  it("overrides every ANSI color in the light scheme so output stays readable", () => {
    const theme = terminalTheme("light")
    for (const key of ANSI_KEYS) {
      const color = theme[key]
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
      if (!color) throw new Error(`missing ANSI color ${key}`)
      // xterm's defaults (e.g. brightYellow #ffff55) vanish on a light
      // background; every slot must keep at least ~2:1 contrast.
      expect(contrast(color, theme.background)).toBeGreaterThanOrEqual(2)
    }
  })

  it("maps a prefers-color-scheme match to a scheme", () => {
    expect(schemeForPrefersDark(true)).toBe("dark")
    expect(schemeForPrefersDark(false)).toBe("light")
  })
})
