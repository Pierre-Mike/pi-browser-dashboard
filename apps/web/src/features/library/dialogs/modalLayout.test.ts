import { describe, expect, it } from "bun:test"
import { MODAL_PANEL } from "./modalLayout"

describe("modalLayout", () => {
  // The native <dialog> element gets `color: canvastext` (black) from the UA
  // stylesheet regardless of the themed root, so the panel must set its own
  // text colour. It has to be the themed token, not a slate literal, or the
  // panel stays slate-on-slate under every non-pid theme.
  it("sets an explicit themed text colour on the panel", () => {
    expect(MODAL_PANEL).toContain("text-base-content")
    expect(MODAL_PANEL).not.toContain("text-slate")
  })

  it("paints its own background from a base token so a theme reaches it", () => {
    expect(MODAL_PANEL).toContain("bg-base-100")
    expect(MODAL_PANEL).not.toContain("bg-white")
    expect(MODAL_PANEL).not.toContain("dark:")
  })
})
