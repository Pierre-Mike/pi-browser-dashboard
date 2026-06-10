import { describe, expect, it } from "bun:test"
import { clampMenuPosition } from "./contextMenu"

describe("clampMenuPosition", () => {
  it("keeps the click point when the menu fits", () => {
    expect(
      clampMenuPosition({
        x: 100,
        y: 100,
        menuWidth: 160,
        menuHeight: 40,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ x: 100, y: 100 })
  })
  it("flips left/up when the menu would overflow the viewport edge", () => {
    expect(
      clampMenuPosition({
        x: 790,
        y: 590,
        menuWidth: 160,
        menuHeight: 40,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ x: 640, y: 560 })
  })
  it("never returns negative coordinates", () => {
    expect(
      clampMenuPosition({
        x: 5,
        y: 5,
        menuWidth: 800,
        menuHeight: 700,
        viewportWidth: 400,
        viewportHeight: 300,
      }),
    ).toEqual({ x: 0, y: 0 })
  })
})
