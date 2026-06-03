import { describe, expect, it } from "bun:test"
import {
  type ArrangeableNode,
  alignNodes,
  distributeNodes,
  findFirstMatch,
  snapToGrid,
} from "./canvasArrange"

const node = ({
  id,
  x,
  y,
  w = 100,
  h = 50,
  extra = {},
}: {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  extra?: Partial<ArrangeableNode>
}): ArrangeableNode => ({ id, position: { x, y }, width: w, height: h, ...extra })

describe("alignNodes", () => {
  it("noops on selections of fewer than 2", () => {
    const ns = [node({ id: "a", x: 0, y: 0 }), node({ id: "b", x: 50, y: 50 })]
    expect(alignNodes({ nodes: ns, selectedIds: ["a"], axis: "left" })).toEqual(ns)
  })

  it("aligns lefts to the smallest x", () => {
    const ns = [
      node({ id: "a", x: 10, y: 0 }),
      node({ id: "b", x: 50, y: 100 }),
      node({ id: "c", x: 200, y: 200 }),
    ]
    const out = alignNodes({ nodes: ns, selectedIds: ["a", "b", "c"], axis: "left" })
    expect(out.map((n) => n.position.x)).toEqual([10, 10, 10])
  })

  it("aligns rights so right-edges line up", () => {
    const ns = [node({ id: "a", x: 0, y: 0, w: 100 }), node({ id: "b", x: 0, y: 50, w: 200 })]
    const out = alignNodes({ nodes: ns, selectedIds: ["a", "b"], axis: "right" })
    // Both right edges should be at the larger right edge (200).
    expect(out[0]?.position.x).toBe(200 - 100)
    expect(out[1]?.position.x).toBe(200 - 200)
  })

  it("centers horizontally around the average midpoint", () => {
    const ns = [node({ id: "a", x: 0, y: 0, w: 100 }), node({ id: "b", x: 100, y: 0, w: 100 })]
    // midpoints: 50, 150 → mean 100. Centers x = 100 - w/2 = 50 for both.
    const out = alignNodes({ nodes: ns, selectedIds: ["a", "b"], axis: "centerX" })
    expect(out[0]?.position.x).toBe(50)
    expect(out[1]?.position.x).toBe(50)
  })
})

describe("distributeNodes", () => {
  it("needs at least 3 to distribute", () => {
    const ns = [node({ id: "a", x: 0, y: 0 }), node({ id: "b", x: 100, y: 0 })]
    expect(distributeNodes({ nodes: ns, selectedIds: ["a", "b"], axis: "horizontal" })).toEqual(ns)
  })

  it("evenly spaces midpoints between the extremes", () => {
    const ns = [
      node({ id: "a", x: 0, y: 0, w: 100 }), // mid 50
      node({ id: "b", x: 80, y: 0, w: 100 }), // mid 130 — should shift to mid 150
      node({ id: "c", x: 200, y: 0, w: 100 }), // mid 250
    ]
    const out = distributeNodes({ nodes: ns, selectedIds: ["a", "b", "c"], axis: "horizontal" })
    // Step = (250 - 50) / 2 = 100. Middle node mid should land at 150.
    const b = out.find((n) => n.id === "b")
    expect(b?.position.x).toBe(150 - 50) // x = mid - w/2
    // Outer nodes stay put.
    expect(out.find((n) => n.id === "a")?.position.x).toBe(0)
    expect(out.find((n) => n.id === "c")?.position.x).toBe(200)
  })
})

describe("snapToGrid", () => {
  it("rounds to the nearest grid step", () => {
    expect(snapToGrid({ x: 12, y: 38 }, 16)).toEqual({ x: 16, y: 32 })
  })
  it("passes through when step is 0", () => {
    expect(snapToGrid({ x: 12, y: 38 }, 0)).toEqual({ x: 12, y: 38 })
  })
})

describe("findFirstMatch", () => {
  const ns = [
    node({ id: "a", x: 0, y: 0, w: 100, h: 50, extra: { data: { label: "Auth flow" } } }),
    node({
      id: "b",
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      extra: { data: { url: "https://anthropic.com" } },
    }),
    node({ id: "c", x: 0, y: 0, w: 100, h: 50, extra: { data: { file: "notes/idea.md" } } }),
  ]
  it("matches label case-insensitively", () => {
    expect(findFirstMatch(ns, "auth")).toBe("a")
    expect(findFirstMatch(ns, "AUTH")).toBe("a")
  })
  it("falls back to url / file fields", () => {
    expect(findFirstMatch(ns, "anthropic")).toBe("b")
    expect(findFirstMatch(ns, "idea")).toBe("c")
  })
  it("returns null on empty or no match", () => {
    expect(findFirstMatch(ns, "")).toBeNull()
    expect(findFirstMatch(ns, "xyzzy")).toBeNull()
  })
})
