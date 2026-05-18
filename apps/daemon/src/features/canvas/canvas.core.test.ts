import { describe, expect, it } from "bun:test"
import {
  type CanvasSnapshot,
  canvasEqual,
  canvasPathFor,
  emptyCanvas,
  parseCanvas,
  serializeCanvas,
} from "./canvas.core"

describe("parseCanvas", () => {
  it("returns an empty canvas for an object with no nodes/edges", () => {
    const snap = parseCanvas({})
    expect(snap.nodes).toEqual([])
    expect(snap.edges).toEqual([])
    expect(snap.version).toBe(1)
  })

  it("preserves a well-formed node", () => {
    const snap = parseCanvas({
      nodes: [{ id: "n1", position: { x: 10, y: 20 }, data: { label: "Box" } }],
    })
    expect(snap.nodes).toHaveLength(1)
    expect(snap.nodes[0]).toMatchObject({
      id: "n1",
      position: { x: 10, y: 20 },
      data: { label: "Box" },
    })
  })

  it("drops nodes missing required fields instead of throwing", () => {
    const snap = parseCanvas({
      nodes: [
        { id: "good", position: { x: 0, y: 0 } },
        { position: { x: 1, y: 1 } }, // no id
        { id: "no-pos" }, // no position
        { id: "bad-pos", position: { x: "nope", y: 0 } }, // non-number pos
        "garbage",
      ],
    })
    expect(snap.nodes.map((n) => n.id)).toEqual(["good"])
  })

  it("preserves a well-formed edge with label and animated", () => {
    const snap = parseCanvas({
      edges: [{ id: "e1", source: "a", target: "b", label: "calls", animated: true }],
    })
    expect(snap.edges).toEqual([
      { id: "e1", source: "a", target: "b", label: "calls", animated: true },
    ])
  })

  it("preserves group-membership fields on a node", () => {
    const snap = parseCanvas({
      nodes: [
        {
          id: "child",
          position: { x: 5, y: 5 },
          parentId: "g1",
          extent: "parent",
          data: { label: "Inside" },
        },
        {
          id: "g1",
          type: "group",
          position: { x: 0, y: 0 },
          style: { width: 200, height: 120 },
          data: { label: "Cluster" },
        },
      ],
    })
    expect(snap.nodes.find((n) => n.id === "child")).toMatchObject({
      parentId: "g1",
      extent: "parent",
    })
    expect(snap.nodes.find((n) => n.id === "g1")).toMatchObject({
      type: "group",
      style: { width: 200, height: 120 },
    })
  })

  it("drops invalid extent values instead of smuggling them through", () => {
    const snap = parseCanvas({
      nodes: [
        {
          id: "x",
          position: { x: 0, y: 0 },
          parentId: "g1",
          extent: "bogus",
        },
      ],
    })
    expect(snap.nodes[0]?.extent).toBeUndefined()
    expect(snap.nodes[0]?.parentId).toBe("g1")
  })

  it("drops edges missing source/target", () => {
    const snap = parseCanvas({
      edges: [
        { id: "ok", source: "a", target: "b" },
        { id: "no-source", target: "b" },
        { id: "no-target", source: "a" },
      ],
    })
    expect(snap.edges.map((e) => e.id)).toEqual(["ok"])
  })

  it("retains a valid viewport and drops a malformed one", () => {
    const good = parseCanvas({ viewport: { x: 1, y: 2, zoom: 0.5 } })
    expect(good.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })

    const bad = parseCanvas({ viewport: { x: 1, y: 2 } })
    expect(bad.viewport).toBeUndefined()
  })

  it("throws when the root is not an object — we won't silently drop a real drawing", () => {
    expect(() => parseCanvas(null)).toThrow()
    expect(() => parseCanvas("nope")).toThrow()
    expect(() => parseCanvas([])).toThrow()
  })
})

describe("emptyCanvas", () => {
  it("is a parse-valid snapshot with no shapes", () => {
    const empty = emptyCanvas()
    expect(empty.nodes).toEqual([])
    expect(empty.edges).toEqual([])
    expect(parseCanvas(empty)).toEqual(empty)
  })
})

describe("canvasPathFor", () => {
  it("returns <configDir>/jobs/<short>/canvas.json", () => {
    expect(canvasPathFor("/home/me/.claude", "abc123")).toBe(
      "/home/me/.claude/jobs/abc123/canvas.json",
    )
  })
})

describe("canvasEqual / serializeCanvas", () => {
  const base: CanvasSnapshot = {
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [{ id: "n1", position: { x: 0, y: 0 } }],
    edges: [],
  }

  it("returns true for structurally-identical snapshots", () => {
    const clone = parseCanvas(JSON.parse(serializeCanvas(base)))
    expect(canvasEqual(base, clone)).toBe(true)
  })

  it("returns false when a node moves", () => {
    const moved: CanvasSnapshot = {
      ...base,
      nodes: [{ id: "n1", position: { x: 5, y: 0 } }],
    }
    expect(canvasEqual(base, moved)).toBe(false)
  })
})
