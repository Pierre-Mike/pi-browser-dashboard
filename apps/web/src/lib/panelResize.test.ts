import { describe, expect, it } from "bun:test"
import {
  clampPanelWidth,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  parsePanelWidth,
  serializePanelWidth,
  widthFromDrag,
} from "./panelResize"

describe("clampPanelWidth", () => {
  it("keeps a width already within bounds (rounded to whole pixels)", () => {
    expect(clampPanelWidth(400)).toBe(400)
    expect(clampPanelWidth(400.6)).toBe(401)
  })

  it("clamps below the minimum and above the maximum", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_MIN_WIDTH)
    expect(clampPanelWidth(9999)).toBe(PANEL_MAX_WIDTH)
  })
})

describe("widthFromDrag", () => {
  it("widens the right-edge panel as the pointer moves left of the drag start", () => {
    // Handle on the panel's LEFT edge: pointer moving left (smaller x) = wider.
    expect(widthFromDrag({ startWidth: 400, startX: 800, currentX: 750 })).toBe(450)
  })

  it("shrinks the panel as the pointer moves right of the drag start", () => {
    expect(widthFromDrag({ startWidth: 400, startX: 800, currentX: 860 })).toBe(340)
  })

  it("never returns a width outside the clamp bounds", () => {
    expect(widthFromDrag({ startWidth: PANEL_DEFAULT_WIDTH, startX: 800, currentX: 5000 })).toBe(
      PANEL_MIN_WIDTH,
    )
    expect(widthFromDrag({ startWidth: PANEL_DEFAULT_WIDTH, startX: 800, currentX: -5000 })).toBe(
      PANEL_MAX_WIDTH,
    )
  })
})

describe("parsePanelWidth", () => {
  it("reads back a stored numeric width, clamped", () => {
    expect(parsePanelWidth("420")).toBe(420)
    expect(parsePanelWidth("99999")).toBe(PANEL_MAX_WIDTH)
  })

  it("returns null for an absent or non-numeric value so the caller can fall back", () => {
    expect(parsePanelWidth(null)).toBeNull()
    expect(parsePanelWidth("")).toBeNull()
    expect(parsePanelWidth("wide")).toBeNull()
  })
})

describe("serializePanelWidth", () => {
  it("round-trips through parsePanelWidth", () => {
    expect(parsePanelWidth(serializePanelWidth(500))).toBe(500)
  })

  it("stores a clamped value so a bad width never persists", () => {
    expect(serializePanelWidth(10)).toBe(String(PANEL_MIN_WIDTH))
  })
})
