import { describe, expect, it } from "bun:test"
import type { CanvasSnapshot } from "./canvas.types"
import {
  colorFor,
  type DuplicableEdge,
  type DuplicableNode,
  duplicateSelection,
  fromJsonCanvas,
  newHistory,
  normalizeArrow,
  parseJsonCanvas,
  pushHistory,
  redo,
  renderInlineMarkdown,
  serializeJsonCanvas,
  toJsonCanvas,
  undo,
} from "./canvasObsidian"

describe("colorFor", () => {
  it("returns empty for unknown keys", () => {
    expect(colorFor("nope")).toEqual({ stroke: "", fill: "" })
    expect(colorFor(undefined)).toEqual({ stroke: "", fill: "" })
  })
  it("maps numeric keys to obsidian colors", () => {
    expect(colorFor("1").stroke).toBe("#ef4444")
    expect(colorFor("4").fill).toBe("#dcfce7")
  })
  it("treats empty string as the explicit 'none' entry", () => {
    expect(colorFor("").stroke).toBe("#94a3b8")
  })
})

describe("normalizeArrow", () => {
  it("defaults to forward for unset", () => {
    expect(normalizeArrow(undefined)).toBe("forward")
    expect(normalizeArrow("nonsense")).toBe("forward")
  })
  it("preserves both/none", () => {
    expect(normalizeArrow("both")).toBe("both")
    expect(normalizeArrow("none")).toBe("none")
  })
})

describe("renderInlineMarkdown", () => {
  it("escapes html before applying patterns", () => {
    expect(renderInlineMarkdown("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    )
  })
  it("renders bold/italic/code", () => {
    expect(renderInlineMarkdown("**bold**")).toBe("<strong>bold</strong>")
    expect(renderInlineMarkdown("a *it* b")).toBe("a <em>it</em> b")
    expect(renderInlineMarkdown("hit `code` ok")).toBe("hit <code>code</code> ok")
  })
  it("renders safe links and rejects javascript: schemes", () => {
    expect(renderInlineMarkdown("[hi](https://x.test)")).toBe(
      '<a href="https://x.test" target="_blank" rel="noreferrer">hi</a>',
    )
    // javascript: is not whitelisted, the literal text passes through unchanged
    const danger = renderInlineMarkdown("[x](javascript:alert(1))")
    expect(danger).not.toContain("javascript:alert")
  })
  it("converts newlines to <br>", () => {
    expect(renderInlineMarkdown("line1\nline2")).toBe("line1<br>line2")
  })
})

describe("history", () => {
  type N = { id: string; position: { x: number; y: number } }
  type E = { id: string; source: string; target: string }

  const frame = (nodes: N[], edges: E[] = []) => ({ nodes, edges })

  it("starts empty", () => {
    const h = newHistory<N, E>()
    expect(h.past).toHaveLength(0)
    expect(h.future).toHaveLength(0)
  })

  it("pushes new frames and clears redo on a new branch", () => {
    let h = newHistory<N, E>()
    h = pushHistory(h, frame([{ id: "a", position: { x: 0, y: 0 } }]))
    h = pushHistory(h, frame([{ id: "a", position: { x: 1, y: 1 } }]))
    expect(h.past).toHaveLength(2)
    const u = undo(h, frame([{ id: "a", position: { x: 2, y: 2 } }]))
    if (!u) throw new Error("expected undoable")
    expect(u.history.future).toHaveLength(1)
    // pushing a new frame after an undo wipes redo
    const branched = pushHistory(u.history, frame([{ id: "a", position: { x: 9, y: 9 } }]))
    expect(branched.future).toHaveLength(0)
  })

  it("dedupes consecutive identical frames", () => {
    let h = newHistory<N, E>()
    const f = frame([{ id: "a", position: { x: 0, y: 0 } }])
    h = pushHistory(h, f)
    h = pushHistory(h, { ...f })
    expect(h.past).toHaveLength(1)
  })

  it("undo restores the previous frame and redo restores the current", () => {
    let h = newHistory<N, E>()
    const f1 = frame([{ id: "a", position: { x: 0, y: 0 } }])
    const f2 = frame([{ id: "a", position: { x: 5, y: 5 } }])
    h = pushHistory(h, f1)
    h = pushHistory(h, f2)
    const u = undo(h, f2)
    if (!u) throw new Error("expected undoable")
    expect(u.frame).toEqual(f1)
    const r = redo(u.history, u.frame)
    if (!r) throw new Error("expected redoable")
    expect(r.frame).toEqual(f2)
  })
})

describe("duplicateSelection", () => {
  let i = 0
  const newId = () => {
    i += 1
    return `dup-${i}`
  }

  it("clones selected nodes with an offset and remaps parent/edges", () => {
    i = 0
    const nodes: DuplicableNode[] = [
      { id: "a", position: { x: 10, y: 10 }, data: { label: "A" } },
      { id: "b", position: { x: 20, y: 20 }, data: { label: "B" } },
      { id: "c", position: { x: 999, y: 999 }, data: { label: "C" } },
    ]
    const edges: DuplicableEdge[] = [
      { id: "e1", source: "a", target: "b" },
      // e2 leaves the selection; should be skipped.
      { id: "e2", source: "a", target: "c" },
    ]
    const out = duplicateSelection({ nodes, edges, selectedIds: ["a", "b"], newId })
    expect(out.nodes).toHaveLength(2)
    expect(out.nodes[0]?.id).toBe("dup-1")
    expect(out.nodes[0]?.position.x).toBe(10 + 32)
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0]?.source).toBe("dup-1")
    expect(out.edges[0]?.target).toBe("dup-2")
  })

  it("remaps parentId when the parent is in the selection too", () => {
    i = 0
    const nodes: DuplicableNode[] = [
      { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
      { id: "n", position: { x: 5, y: 5 }, parentId: "g", extent: "parent" },
    ]
    const out = duplicateSelection({ nodes, edges: [], selectedIds: ["g", "n"], newId })
    const newGroup = out.nodes.find((n) => n.data?.label === "G")
    const newChild = out.nodes.find((n) => n.data?.label !== "G")
    expect(newChild?.parentId).toBe(newGroup?.id)
  })
})

describe("JSON Canvas interop", () => {
  const snap: CanvasSnapshot = {
    version: 1,
    updatedAt: "2026-05-18T00:00:00.000Z",
    nodes: [
      {
        id: "n1",
        type: "box",
        position: { x: 10, y: 20 },
        data: { label: "Hello", color: "3" },
        style: { width: 160, height: 60 },
      },
      {
        id: "g1",
        type: "group",
        position: { x: 100, y: 100 },
        data: { label: "Cluster" },
        style: { width: 320, height: 220 },
      },
      {
        id: "l1",
        type: "link",
        position: { x: 200, y: 200 },
        data: { url: "https://obsidian.md" },
        style: { width: 240, height: 120 },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "n1",
        target: "g1",
        sourceHandle: "right",
        targetHandle: "left",
        label: "links",
        // biome-ignore lint/suspicious/noExplicitAny: edge.data passes through
      } as any,
    ],
  }

  it("converts to Obsidian's JSON Canvas spec shape", () => {
    const jc = toJsonCanvas(snap)
    const n1 = jc.nodes.find((n) => n.id === "n1")
    expect(n1?.type).toBe("text")
    expect(n1?.text).toBe("Hello")
    expect(n1?.color).toBe("3")
    expect(n1?.width).toBe(160)
    expect(jc.nodes.find((n) => n.id === "g1")?.type).toBe("group")
    expect(jc.nodes.find((n) => n.id === "l1")?.type).toBe("link")
    const e1 = jc.edges.find((e) => e.id === "e1")
    expect(e1?.fromNode).toBe("n1")
    expect(e1?.fromSide).toBe("right")
    expect(e1?.toSide).toBe("left")
    expect(e1?.toEnd).toBe("arrow")
  })

  it("round-trips a snapshot through .canvas format", () => {
    const jc = toJsonCanvas(snap)
    const reparsed = parseJsonCanvas(serializeJsonCanvas(jc))
    const back = fromJsonCanvas(reparsed)
    const n1 = back.nodes.find((n) => n.id === "n1")
    expect(n1?.type).toBe("box")
    expect((n1?.data as { label?: string })?.label).toBe("Hello")
    expect((n1?.data as { color?: string })?.color).toBe("3")
    const l1 = back.nodes.find((n) => n.id === "l1")
    expect((l1?.data as { url?: string })?.url).toBe("https://obsidian.md")
    const e1 = back.edges.find((e) => e.id === "e1")
    expect(e1?.sourceHandle).toBe("right")
    expect(e1?.targetHandle).toBe("left")
  })

  it("encodes arrow direction via toEnd/fromEnd", () => {
    const both: CanvasSnapshot = {
      version: 1,
      updatedAt: "2026-05-18T00:00:00.000Z",
      nodes: [],
      // biome-ignore lint/suspicious/noExplicitAny: edge.data passes through
      edges: [{ id: "e", source: "a", target: "b", data: { arrow: "both" } } as any],
    }
    const jc = toJsonCanvas(both)
    expect(jc.edges[0]?.fromEnd).toBe("arrow")
    expect(jc.edges[0]?.toEnd).toBe("arrow")
    const noneSnap: CanvasSnapshot = {
      version: 1,
      updatedAt: "2026-05-18T00:00:00.000Z",
      nodes: [],
      // biome-ignore lint/suspicious/noExplicitAny: edge.data passes through
      edges: [{ id: "e", source: "a", target: "b", data: { arrow: "none" } } as any],
    }
    const noneJc = toJsonCanvas(noneSnap)
    expect(noneJc.edges[0]?.fromEnd).toBe("none")
    expect(noneJc.edges[0]?.toEnd).toBe("none")
  })
})
