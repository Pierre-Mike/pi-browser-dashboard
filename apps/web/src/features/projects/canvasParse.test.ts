import { describe, expect, it } from "bun:test"
import { MarkerType } from "@xyflow/react"
import type { CanvasEdge } from "../canvas/canvas.types"
import {
  decorateCanvasEdge,
  parseCanvasFile,
  snapshotToReactFlowEdges,
  snapshotToReactFlowNodes,
} from "./canvasParse"

const edge = (overrides: Partial<CanvasEdge> = {}): CanvasEdge => ({
  id: "e1",
  source: "a",
  target: "b",
  ...overrides,
})

describe("parseCanvasFile", () => {
  it("returns ok snapshot for a valid JSON Canvas payload", () => {
    const raw = JSON.stringify({
      nodes: [{ id: "n1", type: "text", x: 10, y: 20, width: 200, height: 80, text: "hi" }],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n1" }],
    })
    const result = parseCanvasFile(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.nodes).toHaveLength(1)
    expect(result.snapshot.nodes[0]?.position).toEqual({ x: 10, y: 20 })
    expect(result.snapshot.edges).toHaveLength(1)
  })

  it("returns ok with empty nodes/edges when input is an empty object", () => {
    const result = parseCanvasFile("{}")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.nodes).toHaveLength(0)
    expect(result.snapshot.edges).toHaveLength(0)
  })

  it("returns an error for invalid JSON", () => {
    const result = parseCanvasFile("not json")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.length).toBeGreaterThan(0)
  })
})

describe("snapshotToReactFlowNodes", () => {
  it("defaults the type to 'box' when none is provided and forces read-only flags", () => {
    const parsed = parseCanvasFile(
      JSON.stringify({
        nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 40, text: "hi" }],
        edges: [],
      }),
    )
    if (!parsed.ok) throw new Error("expected parse ok")
    const nodes = snapshotToReactFlowNodes(parsed.snapshot)
    expect(nodes[0]?.type).toBe("box")
    expect(nodes[0]?.draggable).toBe(false)
    expect(nodes[0]?.connectable).toBe(false)
    expect(nodes[0]?.selectable).toBe(true)
  })

  it("preserves group/link/file node types", () => {
    const parsed = parseCanvasFile(
      JSON.stringify({
        nodes: [
          { id: "g", type: "group", x: 0, y: 0, width: 300, height: 200 },
          { id: "l", type: "link", x: 0, y: 0, width: 200, height: 100, url: "https://x.test" },
          { id: "f", type: "file", x: 0, y: 0, width: 200, height: 100, file: "README.md" },
        ],
        edges: [],
      }),
    )
    if (!parsed.ok) throw new Error("expected parse ok")
    const nodes = snapshotToReactFlowNodes(parsed.snapshot)
    const byId = new Map(nodes.map((n) => [n.id, n.type]))
    expect(byId.get("g")).toBe("group")
    expect(byId.get("l")).toBe("link")
    expect(byId.get("f")).toBe("file")
  })
})

describe("decorateCanvasEdge", () => {
  it("adds an arrow marker on the target end by default", () => {
    const out = decorateCanvasEdge(edge())
    expect(out.markerEnd?.type).toBe(MarkerType.ArrowClosed)
    expect(out.markerStart).toBeUndefined()
  })

  it("adds markers on both ends when arrow direction is 'both'", () => {
    const out = decorateCanvasEdge(edge({ data: { arrow: "both" } }))
    expect(out.markerEnd?.type).toBe(MarkerType.ArrowClosed)
    expect(out.markerStart?.type).toBe(MarkerType.ArrowClosed)
  })

  it("omits markers entirely when arrow direction is 'none'", () => {
    const out = decorateCanvasEdge(edge({ data: { arrow: "none" } }))
    expect(out.markerEnd).toBeUndefined()
    expect(out.markerStart).toBeUndefined()
  })

  it("applies Obsidian color palette to stroke and marker", () => {
    const out = decorateCanvasEdge(edge({ data: { color: "1" } }))
    expect(out.style?.stroke).toBe("#ef4444")
    expect(out.markerEnd?.color).toBe("#ef4444")
  })
})

describe("snapshotToReactFlowEdges", () => {
  it("decorates every edge of the snapshot", () => {
    const parsed = parseCanvasFile(
      JSON.stringify({
        nodes: [],
        edges: [
          { id: "e1", fromNode: "a", toNode: "b" },
          { id: "e2", fromNode: "a", toNode: "b", toEnd: "none", fromEnd: "none" },
        ],
      }),
    )
    if (!parsed.ok) throw new Error("expected parse ok")
    const edges = snapshotToReactFlowEdges(parsed.snapshot)
    expect(edges).toHaveLength(2)
    expect(edges[0]?.markerEnd?.type).toBe(MarkerType.ArrowClosed)
    expect(edges[1]?.markerEnd).toBeUndefined()
  })
})
