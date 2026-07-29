import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import type { CanvasSnapshot } from "./canvas.core"
import {
  parseJsonCanvas as decodeJsonCanvas,
  jsonCanvasEqual,
  serializeJsonCanvas,
  toJsonCanvas,
} from "./jsonCanvas.core"

// The decoder returns Either; happy paths unwrap, the failure contract is
// asserted on the Left directly.
const parseJsonCanvas = (raw: unknown): CanvasSnapshot => {
  const decoded = decodeJsonCanvas(raw)
  if (Either.isLeft(decoded)) throw new Error(decoded.left)
  return decoded.right
}

const snapshot = (over: Partial<CanvasSnapshot>): CanvasSnapshot => ({
  version: 1,
  updatedAt: "1970-01-01T00:00:00.000Z",
  nodes: [],
  edges: [],
  ...over,
})

describe("parseJsonCanvas", () => {
  it("maps an Obsidian text node onto a React-Flow box node", () => {
    const snap = parseJsonCanvas({
      nodes: [{ id: "a", type: "text", x: 40, y: -20, width: 260, height: 80, text: "an idea" }],
      edges: [],
    })
    expect(snap.nodes).toEqual([
      {
        id: "a",
        type: "box",
        position: { x: 40, y: -20 },
        data: { label: "an idea" },
        style: { width: 260, height: 80 },
      },
    ])
  })

  it("keeps a group's label and a colored node's color", () => {
    const snap = parseJsonCanvas({
      nodes: [
        { id: "g", type: "group", x: 0, y: 0, width: 400, height: 300, label: "auth", color: "4" },
      ],
      edges: [],
    })
    expect(snap.nodes[0]?.type).toBe("group")
    expect(snap.nodes[0]?.data).toEqual({ label: "auth", color: "4" })
  })

  it("carries link urls and file paths through as node data", () => {
    const snap = parseJsonCanvas({
      nodes: [
        { id: "l", type: "link", x: 0, y: 0, width: 100, height: 40, url: "https://example.com" },
        { id: "f", type: "file", x: 0, y: 60, width: 100, height: 40, file: "docs/spec.md" },
      ],
      edges: [],
    })
    expect(snap.nodes[0]).toMatchObject({ type: "link", data: { url: "https://example.com" } })
    expect(snap.nodes[1]).toMatchObject({ type: "file", data: { file: "docs/spec.md" } })
  })

  it("maps edge endpoints, sides, label and color", () => {
    const snap = parseJsonCanvas({
      nodes: [],
      edges: [
        {
          id: "e1",
          fromNode: "a",
          toNode: "b",
          fromSide: "right",
          toSide: "left",
          label: "then",
          color: "2",
        },
      ],
    })
    expect(snap.edges).toEqual([
      {
        id: "e1",
        source: "a",
        target: "b",
        sourceHandle: "right",
        targetHandle: "left",
        label: "then",
        data: { arrow: "forward", color: "2" },
      },
    ])
  })

  it("reads arrow direction from the two end markers", () => {
    const arrowOf = (ends: Record<string, unknown>): unknown =>
      parseJsonCanvas({ nodes: [], edges: [{ id: "e", fromNode: "a", toNode: "b", ...ends }] })
        .edges[0]?.data?.arrow

    expect(arrowOf({ fromEnd: "arrow", toEnd: "arrow" })).toBe("both")
    expect(arrowOf({ fromEnd: "none", toEnd: "none" })).toBe("none")
    expect(arrowOf({ toEnd: "arrow" })).toBe("forward")
    expect(arrowOf({})).toBe("forward")
  })

  it("drops malformed nodes and edges instead of failing the document", () => {
    const snap = parseJsonCanvas({
      nodes: [{ id: "ok", x: 0, y: 0 }, { x: 1, y: 1 }, { id: "no-coords" }, 7],
      edges: [
        { id: "e", fromNode: "a", toNode: "b" },
        { id: "half", fromNode: "a" },
      ],
    })
    expect(snap.nodes.map((n) => n.id)).toEqual(["ok"])
    expect(snap.edges.map((e) => e.id)).toEqual(["e"])
  })

  it("tolerates a document with no nodes/edges keys at all", () => {
    expect(parseJsonCanvas({})).toEqual(snapshot({}))
  })

  it("refuses a non-object root as a value, not a throw", () => {
    expect(Either.isLeft(decodeJsonCanvas([]))).toBe(true)
    expect(Either.isLeft(decodeJsonCanvas("nope"))).toBe(true)
  })
})

describe("serializeJsonCanvas", () => {
  it("writes Obsidian keys only — no React-Flow position, no updatedAt", () => {
    const body = serializeJsonCanvas(
      snapshot({
        updatedAt: "2026-07-28T00:00:00.000Z",
        nodes: [
          {
            id: "a",
            type: "box",
            position: { x: 10, y: 20 },
            data: { label: "hi" },
            style: { width: 200, height: 60 },
          },
        ],
      }),
    )
    const raw = JSON.parse(body) as Record<string, unknown>
    expect(Object.keys(raw).sort()).toEqual(["edges", "nodes"])
    expect(raw.nodes).toEqual([
      { id: "a", type: "text", x: 10, y: 20, width: 200, height: 60, text: "hi" },
    ])
  })

  it("falls back to default sizes when a node carries none", () => {
    const jc = toJsonCanvas(
      snapshot({
        nodes: [
          { id: "n", type: "box", position: { x: 0, y: 0 } },
          { id: "g", type: "group", position: { x: 0, y: 0 } },
        ],
      }),
    )
    expect(jc.nodes[0]).toMatchObject({ width: 160, height: 60 })
    expect(jc.nodes[1]).toMatchObject({ width: 280, height: 200 })
  })

  it("round-trips a canvas through the Obsidian format", () => {
    const before = snapshot({
      nodes: [
        {
          id: "a",
          type: "box",
          position: { x: 5, y: 6 },
          data: { label: "start", color: "1" },
          style: { width: 200, height: 60 },
        },
      ],
      edges: [
        {
          id: "e",
          source: "a",
          target: "a",
          label: "loop",
          sourceHandle: "top",
          targetHandle: "bottom",
          data: { arrow: "both", color: "3" },
        },
      ],
    })
    expect(parseJsonCanvas(JSON.parse(serializeJsonCanvas(before)))).toEqual(before)
  })
})

describe("jsonCanvasEqual", () => {
  it("ignores updatedAt — it is never persisted in a .canvas file", () => {
    const a = snapshot({ updatedAt: "2026-01-01T00:00:00.000Z" })
    const b = snapshot({ updatedAt: "2026-07-28T00:00:00.000Z" })
    expect(jsonCanvasEqual({ a, b })).toBe(true)
  })

  it("separates canvases that differ in a node", () => {
    const a = snapshot({ nodes: [{ id: "a", position: { x: 0, y: 0 } }] })
    const b = snapshot({ nodes: [{ id: "a", position: { x: 1, y: 0 } }] })
    expect(jsonCanvasEqual({ a, b })).toBe(false)
  })
})
