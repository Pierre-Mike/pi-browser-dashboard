import { describe, expect, it } from "bun:test"
import { type GroupableNode, groupSelected, ungroupNode } from "./canvasGrouping"

const boxes: GroupableNode[] = [
  { id: "a", position: { x: 100, y: 100 }, width: 120, height: 40, data: { label: "A" } },
  { id: "b", position: { x: 300, y: 160 }, width: 120, height: 40, data: { label: "B" } },
  { id: "c", position: { x: 800, y: 800 }, width: 120, height: 40, data: { label: "C" } },
]

describe("groupSelected", () => {
  it("returns a noop result when nothing is selected", () => {
    const out = groupSelected({ nodes: boxes, selectedIds: [] })
    expect(out.groupId).toBeNull()
    expect(out.nodes).toEqual(boxes)
  })

  it("creates a group node containing the selected boxes", () => {
    const out = groupSelected({
      nodes: boxes,
      selectedIds: ["a", "b"],
      opts: { groupId: "g1", label: "Cluster" },
    })
    expect(out.groupId).toBe("g1")

    const group = out.nodes.find((n) => n.id === "g1")
    expect(group?.type).toBe("group")
    expect(group?.data).toEqual({ label: "Cluster" })

    // Group must contain the bounding box of A (100..220, 100..140) and
    // B (300..420, 160..200), with padding on every side and label gutter on top.
    expect((group?.style?.width as number) ?? 0).toBeGreaterThan(420 - 100)
    expect((group?.style?.height as number) ?? 0).toBeGreaterThan(200 - 100)
  })

  it("rewrites child positions to be relative to the group origin", () => {
    const out = groupSelected({ nodes: boxes, selectedIds: ["a", "b"], opts: { groupId: "g1" } })
    const group = out.nodes.find((n) => n.id === "g1")
    const a = out.nodes.find((n) => n.id === "a")
    const b = out.nodes.find((n) => n.id === "b")

    expect(a?.parentId).toBe("g1")
    expect(a?.extent).toBe("parent")
    expect(b?.parentId).toBe("g1")
    expect(b?.extent).toBe("parent")

    // Absolute reconstruction must match the original positions.
    expect((a?.position.x ?? 0) + (group?.position.x ?? 0)).toBeCloseTo(100)
    expect((a?.position.y ?? 0) + (group?.position.y ?? 0)).toBeCloseTo(100)
    expect((b?.position.x ?? 0) + (group?.position.x ?? 0)).toBeCloseTo(300)
    expect((b?.position.y ?? 0) + (group?.position.y ?? 0)).toBeCloseTo(160)
  })

  it("puts the group node before its children so React Flow renders parent-first", () => {
    const out = groupSelected({ nodes: boxes, selectedIds: ["a", "b"], opts: { groupId: "g1" } })
    const order = out.nodes.map((n) => n.id)
    expect(order.indexOf("g1")).toBeLessThan(order.indexOf("a"))
    expect(order.indexOf("g1")).toBeLessThan(order.indexOf("b"))
  })

  it("skips nodes that are already inside a group", () => {
    const seeded = [
      { id: "g0", type: "group", position: { x: 0, y: 0 }, style: { width: 200, height: 200 } },
      { id: "x", position: { x: 10, y: 10 }, parentId: "g0", extent: "parent" as const },
      { id: "y", position: { x: 500, y: 500 } },
    ]
    const out = groupSelected({ nodes: seeded, selectedIds: ["x", "y"], opts: { groupId: "g1" } })
    // x is already grouped — only y should land in g1.
    const y = out.nodes.find((n) => n.id === "y")
    const x = out.nodes.find((n) => n.id === "x")
    expect(y?.parentId).toBe("g1")
    expect(x?.parentId).toBe("g0")
  })
})

describe("ungroupNode", () => {
  it("drops the group and promotes children back to absolute coordinates", () => {
    const grouped = groupSelected({
      nodes: boxes,
      selectedIds: ["a", "b"],
      opts: { groupId: "g1" },
    }).nodes
    const flat = ungroupNode(grouped, "g1")
    expect(flat.find((n) => n.id === "g1")).toBeUndefined()
    const a = flat.find((n) => n.id === "a")
    const b = flat.find((n) => n.id === "b")
    expect(a?.parentId).toBeUndefined()
    expect(a?.extent).toBeUndefined()
    expect(a?.position).toEqual({ x: 100, y: 100 })
    expect(b?.position).toEqual({ x: 300, y: 160 })
  })

  it("is a noop when the id is not a group", () => {
    const out = ungroupNode(boxes, "a")
    expect(out).toEqual(boxes)
  })
})
