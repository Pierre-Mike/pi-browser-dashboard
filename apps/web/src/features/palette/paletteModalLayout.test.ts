import { describe, expect, it } from "bun:test"
import { PALETTE_INPUT, PALETTE_MODAL_SHELL } from "./paletteModalLayout"

describe("paletteModalLayout", () => {
  // The palette portals into document.body, outside the themed root div, so
  // it must carry a semantic text-base-content class that the daisyUI theme resolves
  // correctly in both pidlight and piddark without hand-written light/dark pairs.
  it("sets semantic text color on the shell", () => {
    expect(PALETTE_MODAL_SHELL).toContain("text-base-content")
  })

  it("keeps typed query text readable on the transparent input", () => {
    expect(PALETTE_INPUT).toContain("text-base-content")
  })

  it("keeps the placeholder visible but muted", () => {
    expect(PALETTE_INPUT).toContain("placeholder:text-base-content/40")
  })
})
