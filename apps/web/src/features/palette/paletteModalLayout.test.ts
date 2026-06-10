import { describe, expect, it } from "bun:test"
import { PALETTE_INPUT, PALETTE_MODAL_SHELL } from "./paletteModalLayout"

describe("paletteModalLayout", () => {
  // The palette portals into document.body, outside the themed root div, so
  // it must set its own readable text color in both light and dark mode.
  it("sets explicit text colors on the shell for light and dark mode", () => {
    expect(PALETTE_MODAL_SHELL).toContain("text-slate-900")
    expect(PALETTE_MODAL_SHELL).toContain("dark:text-slate-100")
  })

  it("keeps typed query text readable on the transparent input", () => {
    expect(PALETTE_INPUT).toContain("text-slate-900")
    expect(PALETTE_INPUT).toContain("dark:text-slate-100")
  })

  it("keeps the placeholder visible but muted in both modes", () => {
    expect(PALETTE_INPUT).toContain("placeholder:text-slate-400")
    expect(PALETTE_INPUT).toContain("dark:placeholder:text-slate-500")
  })
})
