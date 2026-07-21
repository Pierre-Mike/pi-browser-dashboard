import { describe, expect, it } from "bun:test"
import {
  BOX_DEFAULT_HEIGHT,
  BOX_DEFAULT_WIDTH,
  defaultLinkUrl,
  isPaneClassName,
  newBoxAt,
  pickedFileRef,
  shouldOpenLink,
} from "./canvasInteractions"

describe("newBoxAt", () => {
  it("centers the box on the pointer", () => {
    const box = newBoxAt({ x: 200, y: 100 }, "n-1")
    expect(box.position).toEqual({
      x: 200 - BOX_DEFAULT_WIDTH / 2,
      y: 100 - BOX_DEFAULT_HEIGHT / 2,
    })
  })

  it("rounds the position to whole pixels", () => {
    const box = newBoxAt({ x: 200.6, y: 100.4 }, "n-1")
    expect(Number.isInteger(box.position.x)).toBe(true)
    expect(Number.isInteger(box.position.y)).toBe(true)
  })

  it("starts empty and selected so it opens in edit mode (Obsidian dbl-click)", () => {
    const box = newBoxAt({ x: 0, y: 0 }, "n-xyz")
    expect(box.id).toBe("n-xyz")
    expect(box.type).toBe("box")
    expect(box.data.label).toBe("")
    expect(box.selected).toBe(true)
    expect(box.style).toEqual({ width: BOX_DEFAULT_WIDTH, height: BOX_DEFAULT_HEIGHT })
  })
})

describe("isPaneClassName", () => {
  it("matches the React Flow pane class", () => {
    expect(isPaneClassName("react-flow__pane")).toBe(true)
    expect(isPaneClassName("react-flow__pane draggable")).toBe(true)
  })

  it("rejects node / handle / other targets", () => {
    expect(isPaneClassName("react-flow__node")).toBe(false)
    expect(isPaneClassName("react-flow__handle")).toBe(false)
    expect(isPaneClassName("")).toBe(false)
    expect(isPaneClassName(undefined)).toBe(false)
    // SVG elements expose className as an object, not a string — never a pane.
    expect(isPaneClassName({ baseVal: "react-flow__pane" })).toBe(false)
  })
})

describe("defaultLinkUrl", () => {
  it("defaults a new link to the project-local origin root", () => {
    expect(defaultLinkUrl("http://localhost:5173")).toBe("http://localhost:5173/")
  })

  it("collapses trailing slashes to a single one", () => {
    expect(defaultLinkUrl("http://localhost:5173/")).toBe("http://localhost:5173/")
    expect(defaultLinkUrl("http://localhost:5173///")).toBe("http://localhost:5173/")
  })

  it("returns empty for a blank origin", () => {
    expect(defaultLinkUrl("")).toBe("")
    expect(defaultLinkUrl("   ")).toBe("")
  })
})

describe("shouldOpenLink", () => {
  it("opens in a new tab only on a modifier click (⌘ / Ctrl)", () => {
    expect(shouldOpenLink({ metaKey: true })).toBe(true)
    expect(shouldOpenLink({ ctrlKey: true })).toBe(true)
    expect(shouldOpenLink({ metaKey: true, ctrlKey: true })).toBe(true)
  })

  it("reserves a plain click for selecting/editing the link node", () => {
    // A plain (double-)click must NOT navigate, otherwise the first click of a
    // double-click follows the href and the node can never be re-edited.
    expect(shouldOpenLink({})).toBe(false)
    expect(shouldOpenLink({ metaKey: false, ctrlKey: false })).toBe(false)
  })
})

describe("pickedFileRef", () => {
  it("returns the first picked file's name", () => {
    expect(pickedFileRef([{ name: "diagram.png" }, { name: "other.md" }])).toBe("diagram.png")
  })

  it("returns null when nothing was picked", () => {
    expect(pickedFileRef([])).toBeNull()
    expect(pickedFileRef(null)).toBeNull()
    expect(pickedFileRef(undefined)).toBeNull()
  })
})
