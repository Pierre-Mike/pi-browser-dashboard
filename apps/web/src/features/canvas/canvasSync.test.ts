import { describe, expect, it } from "bun:test"
import type { CanvasSnapshot } from "./canvas.types"
import {
  canvasShouldSend,
  canvasStableKey,
  reactFlowToSnapshot,
  snapshotToReactFlow,
} from "./canvasSync"

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

describe("edge attribute round-trip", () => {
  // The toolbar writes arrow direction and color into edge `data`; the
  // inline editor writes `label`. All three must survive both directions of
  // the wire mapping or the user's choices silently vanish on the next sync.
  const wireEdge = {
    id: "e1",
    source: "a",
    target: "b",
    label: "depends on",
    sourceHandle: "right",
    targetHandle: "left",
    data: { arrow: "both", color: "4" },
  } as const

  it("keeps label and data from wire to react-flow", () => {
    const { edges } = snapshotToReactFlow(snap({ edges: [wireEdge] }))
    expect(edges[0]?.label).toBe("depends on")
    expect(edges[0]?.data).toEqual({ arrow: "both", color: "4" })
  })

  it("keeps label and data from react-flow back to wire", () => {
    const { edges } = snapshotToReactFlow(snap({ edges: [wireEdge] }))
    const back = reactFlowToSnapshot({ nodes: [], edges })
    expect(back.edges[0]?.label).toBe("depends on")
    expect(back.edges[0]?.data).toEqual({ arrow: "both", color: "4" })
  })

  it("keeps node geometry and data through a full round-trip", () => {
    const wire = snap({
      nodes: [
        {
          id: "n1",
          position: { x: 10, y: 20 },
          type: "box",
          data: { label: "Web app", color: "2" },
          style: { width: 160, height: 60 },
        },
      ],
    })
    const rf = snapshotToReactFlow(wire)
    const back = reactFlowToSnapshot({ nodes: rf.nodes, edges: [] })
    expect(back.nodes[0]?.position).toEqual({ x: 10, y: 20 })
    expect(back.nodes[0]?.data).toEqual({ label: "Web app", color: "2" })
    expect(back.nodes[0]?.style).toEqual({ width: 160, height: 60 })
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
