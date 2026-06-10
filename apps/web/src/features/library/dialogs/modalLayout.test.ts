import { describe, expect, it } from "bun:test"
import { MODAL_PANEL } from "./modalLayout"

describe("modalLayout", () => {
  // The native <dialog> element gets `color: canvastext` (black) from the UA
  // stylesheet regardless of the themed root, so the panel must set its own
  // readable text color in both light and dark mode.
  it("sets explicit text colors on the panel for light and dark mode", () => {
    expect(MODAL_PANEL).toContain("text-slate-900")
    expect(MODAL_PANEL).toContain("dark:text-slate-100")
  })

  it("keeps the dark panel background the tokens were tuned against", () => {
    expect(MODAL_PANEL).toContain("dark:bg-slate-900")
  })
})
