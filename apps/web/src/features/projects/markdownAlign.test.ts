import { describe, expect, it } from "bun:test"
import { alignClass } from "./markdownAlign"

describe("alignClass", () => {
  it("maps GFM cell alignment to a Tailwind text-align class", () => {
    expect(alignClass("left")).toBe("text-left")
    expect(alignClass("center")).toBe("text-center")
    expect(alignClass("right")).toBe("text-right")
  })

  it("falls back to left when no alignment is set", () => {
    expect(alignClass(undefined)).toBe("text-left")
    expect(alignClass(null)).toBe("text-left")
  })

  it("falls back to left for non-alignment values", () => {
    expect(alignClass("justify")).toBe("text-left")
    expect(alignClass(42)).toBe("text-left")
  })
})
