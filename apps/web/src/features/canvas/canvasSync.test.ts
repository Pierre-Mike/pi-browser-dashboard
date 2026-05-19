import { describe, expect, it } from "bun:test"
import type { CanvasSnapshot } from "./canvas.types"
import { canvasShouldSend, canvasStableKey } from "./canvasSync"

const snap = (overrides: Partial<CanvasSnapshot> = {}): CanvasSnapshot => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  nodes: [],
  edges: [],
  ...overrides,
})

describe("canvasShouldSend", () => {
  it("returns false before the first server snapshot — we won't clobber unseen state", () => {
    expect(canvasShouldSend(snap(), null)).toBe(false)
  })

  it("returns false when latest matches lastWire structurally", () => {
    const a = snap({ nodes: [{ id: "n1", position: { x: 0, y: 0 } }] })
    const b = snap({ nodes: [{ id: "n1", position: { x: 0, y: 0 } }] })
    expect(canvasShouldSend(a, b)).toBe(false)
  })

  it("ignores updatedAt drift when comparing", () => {
    const a = snap({ updatedAt: "2026-01-01T00:00:00.000Z" })
    const b = snap({ updatedAt: "2027-12-31T23:59:59.999Z" })
    expect(canvasShouldSend(a, b)).toBe(false)
  })

  it("returns true when a node moves", () => {
    const a = snap({ nodes: [{ id: "n1", position: { x: 0, y: 0 } }] })
    const b = snap({ nodes: [{ id: "n1", position: { x: 5, y: 0 } }] })
    expect(canvasShouldSend(b, a)).toBe(true)
  })

  it("returns true when edges differ", () => {
    const a = snap({ edges: [] })
    const b = snap({ edges: [{ id: "e1", source: "x", target: "y" }] })
    expect(canvasShouldSend(b, a)).toBe(true)
  })
})

describe("canvasStableKey", () => {
  it("is stable across updatedAt rewrites", () => {
    const a = snap({
      updatedAt: "2026-01-01T00:00:00.000Z",
      nodes: [{ id: "n1", position: { x: 1, y: 2 } }],
    })
    const b = snap({
      updatedAt: "2099-01-01T00:00:00.000Z",
      nodes: [{ id: "n1", position: { x: 1, y: 2 } }],
    })
    expect(canvasStableKey(a)).toBe(canvasStableKey(b))
  })
})
