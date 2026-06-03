// Pure helpers for the Obsidian-Canvas-parity features added on top of the
// React Flow canvas: color palette, arrow markers, inline markdown, undo/redo
// history, duplicate-with-offset, and Obsidian JSON Canvas (.canvas) interop.
//
// Everything here is side-effect free so we can unit-test it without React.

import type { CanvasEdge, CanvasNode, CanvasSnapshot } from "./canvas.types"

// --- Color palette ------------------------------------------------------------
//
// Obsidian uses 6 preset colors keyed "1".."6" plus blank for "no color". We
// keep the same keying so a canvas exported to .canvas and re-imported keeps
// its colors. The CSS values mirror Obsidian's default theme (light variants);
// dark mode is handled via tailwind dark: classes downstream.

export type ObsidianColor = "" | "1" | "2" | "3" | "4" | "5" | "6"

export const OBSIDIAN_COLORS: ReadonlyArray<{
  readonly key: ObsidianColor
  readonly label: string
  readonly stroke: string
  readonly fill: string
}> = [
  { key: "", label: "none", stroke: "#94a3b8", fill: "transparent" },
  { key: "1", label: "red", stroke: "#ef4444", fill: "#fee2e2" },
  { key: "2", label: "orange", stroke: "#f97316", fill: "#ffedd5" },
  { key: "3", label: "yellow", stroke: "#eab308", fill: "#fef9c3" },
  { key: "4", label: "green", stroke: "#22c55e", fill: "#dcfce7" },
  { key: "5", label: "cyan", stroke: "#06b6d4", fill: "#cffafe" },
  { key: "6", label: "purple", stroke: "#a855f7", fill: "#f3e8ff" },
]

const COLOR_BY_KEY = new Map(OBSIDIAN_COLORS.map((c) => [c.key, c]))

export const colorFor = (key: unknown): { stroke: string; fill: string } => {
  if (typeof key !== "string") return { stroke: "", fill: "" }
  const hit = COLOR_BY_KEY.get(key as ObsidianColor)
  if (!hit) return { stroke: "", fill: "" }
  return { stroke: hit.stroke, fill: hit.fill }
}

// --- Arrow direction ----------------------------------------------------------

export type ArrowDirection = "forward" | "both" | "none"

export const normalizeArrow = (v: unknown): ArrowDirection => {
  if (v === "both" || v === "none") return v
  return "forward"
}

// --- Inline markdown ----------------------------------------------------------
//
// We render a deliberately tiny subset of markdown — **bold**, *italic*,
// `code`, [text](url), and line breaks. Everything else passes through as
// literal text. We do not parse arbitrary HTML; the input is escaped first.

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

// Allow only http(s) and mailto: in markdown links to avoid javascript: smuggling.
const safeHref = (url: string): string | null => {
  const trimmed = url.trim()
  if (!/^(https?:|mailto:)/i.test(trimmed)) return null
  return trimmed
}

export const renderInlineMarkdown = (text: string): string => {
  // Escape, then apply each pattern. Order matters: handle code spans first so
  // their contents don't get re-interpreted as bold/italic.
  let out = escapeHtml(text)
  // `inline code`
  out = out.replace(/`([^`]+)`/g, (_, body: string) => `<code>${body}</code>`)
  // [label](url)
  // biome-ignore lint/complexity/useMaxParams: regex replace callback — positional args required by String.replace API
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_full, label: string, raw: string) => {
    const href = safeHref(raw)
    // Drop the link entirely when the scheme isn't whitelisted — we keep the
    // label text so the user still sees their content, but never echo the
    // unsafe URL back into the DOM.
    if (!href) return label
    return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
  })
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  // *italic* — only when surrounded by word boundaries to avoid eating ** runs.
  out = out.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1<em>$2</em>")
  // Newlines → <br>
  out = out.replace(/\n/g, "<br>")
  return out
}

// --- Undo/redo history --------------------------------------------------------
//
// We store structural snapshots {nodes, edges} on the stack. Each commit pushes
// onto `past` and clears `future`. Undo moves the head from `past` to `future`,
// redo the inverse. The caller decides when to commit — typically after a drag
// settles or after a non-drag mutation.

export type HistoryFrame<N, E> = {
  readonly nodes: ReadonlyArray<N>
  readonly edges: ReadonlyArray<E>
}

export type History<N, E> = {
  readonly past: ReadonlyArray<HistoryFrame<N, E>>
  readonly future: ReadonlyArray<HistoryFrame<N, E>>
}

export const newHistory = <N, E>(): History<N, E> => ({ past: [], future: [] })

const HISTORY_LIMIT = 50

const sameFrame = <N, E>(a: HistoryFrame<N, E>, b: HistoryFrame<N, E>): boolean => {
  if (a.nodes === b.nodes && a.edges === b.edges) return true
  // Structural compare is JSON.stringify — small canvases, cheap. We strip
  // React Flow's transient `selected`/`dragging` keys before comparing so the
  // selection cursor doesn't pollute history.
  return canvasHistoryKey(a) === canvasHistoryKey(b)
}

const canvasHistoryKey = <N, E>(frame: HistoryFrame<N, E>): string => {
  const stripped = {
    nodes: frame.nodes.map((n) => {
      const { selected: _s, dragging: _d, measured: _m, ...rest } = n as Record<string, unknown>
      return rest
    }),
    edges: frame.edges.map((e) => {
      const { selected: _s, ...rest } = e as Record<string, unknown>
      return rest
    }),
  }
  return JSON.stringify(stripped)
}

export const pushHistory = <N, E>(h: History<N, E>, frame: HistoryFrame<N, E>): History<N, E> => {
  const last = h.past[h.past.length - 1]
  if (last && sameFrame(last, frame)) return h
  const next = [...h.past, frame]
  // Cap the stack so very long sessions don't grow unbounded.
  const trimmed = next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
  return { past: trimmed, future: [] }
}

// Model: `past` is the timeline of committed states, with the most recent at
// the end. The active state is *also* at the end of `past` (every commit is a
// push). Undo pops the latest commit onto `future` and returns the now-top of
// `past` as the state to apply; redo is the inverse. This means you need at
// least two commits in `past` before undo can move anywhere — the very first
// push is the floor.
export const undo = <N, E>(
  h: History<N, E>,
  _current: HistoryFrame<N, E>,
): { history: History<N, E>; frame: HistoryFrame<N, E> } | null => {
  if (h.past.length < 2) return null
  const popped = h.past[h.past.length - 1]
  const target = h.past[h.past.length - 2]
  if (!popped || !target) return null
  return {
    history: { past: h.past.slice(0, -1), future: [popped, ...h.future] },
    frame: target,
  }
}

export const redo = <N, E>(
  h: History<N, E>,
  _current: HistoryFrame<N, E>,
): { history: History<N, E>; frame: HistoryFrame<N, E> } | null => {
  if (h.future.length === 0) return null
  const next = h.future[0]
  if (!next) return null
  return {
    history: { past: [...h.past, next], future: h.future.slice(1) },
    frame: next,
  }
}

// --- Duplicate selection ------------------------------------------------------
//
// Duplicate the selected nodes (and any edges entirely between them) with a
// small offset. Returns the new nodes + edges (with fresh ids). Caller appends
// them to the existing arrays and swaps selection onto the new ids.

export type DuplicableNode = {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly type?: string
  readonly data?: Record<string, unknown>
  readonly width?: number | null
  readonly height?: number | null
  readonly parentId?: string | null
  readonly extent?: "parent" | unknown
  readonly style?: Record<string, unknown> | null
  readonly selected?: boolean
}

export type DuplicableEdge = {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly type?: string
  readonly label?: string
  readonly animated?: boolean
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly data?: Record<string, unknown>
}

const DUPLICATE_OFFSET = 32

export const duplicateSelection = (args: {
  readonly nodes: ReadonlyArray<DuplicableNode>
  readonly edges: ReadonlyArray<DuplicableEdge>
  readonly selectedIds: ReadonlyArray<string>
  readonly newId: () => string
}): {
  readonly nodes: ReadonlyArray<DuplicableNode>
  readonly edges: ReadonlyArray<DuplicableEdge>
  readonly idMap: ReadonlyMap<string, string>
} => {
  const selected = new Set(args.selectedIds)
  const idMap = new Map<string, string>()
  for (const id of args.selectedIds) idMap.set(id, args.newId())

  const cloned = args.nodes
    .filter((n) => selected.has(n.id))
    .map((n) => {
      const newId = idMap.get(n.id)
      if (!newId) return null
      const parent = n.parentId && idMap.get(n.parentId) ? idMap.get(n.parentId) : null
      const out: DuplicableNode = {
        ...n,
        id: newId,
        position: { x: n.position.x + DUPLICATE_OFFSET, y: n.position.y + DUPLICATE_OFFSET },
        parentId: parent ?? undefined,
        selected: true,
      }
      return out
    })
    .filter((n): n is DuplicableNode => n !== null)

  const clonedEdges = args.edges
    .filter((e) => selected.has(e.source) && selected.has(e.target))
    .map((e) => {
      const source = idMap.get(e.source)
      const target = idMap.get(e.target)
      if (!source || !target) return null
      return { ...e, id: args.newId(), source, target }
    })
    .filter((e): e is DuplicableEdge => e !== null)

  return { nodes: cloned, edges: clonedEdges, idMap }
}

// --- Obsidian JSON Canvas (.canvas) interop -----------------------------------
//
// jsoncanvas.org: nodes use top-level x/y/width/height/color and a `type` of
// "text"|"file"|"link"|"group" with type-specific fields. Edges use fromNode/
// fromSide/toNode/toSide and optional fromEnd/toEnd/color/label.
//
// We convert to/from our internal React-Flow-flavored snapshot. Our snapshot
// stores x/y in node.position, sizes in node.style or node.width/height, color
// in node.data.color, and arrow direction in edge.data.arrow.

type JsonCanvasNode = {
  readonly id: string
  readonly type: "text" | "file" | "link" | "group"
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly color?: string
  readonly text?: string
  readonly file?: string
  readonly url?: string
  readonly label?: string
}

type JsonCanvasEdge = {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly fromSide?: "top" | "right" | "bottom" | "left"
  readonly toSide?: "top" | "right" | "bottom" | "left"
  readonly fromEnd?: "none" | "arrow"
  readonly toEnd?: "none" | "arrow"
  readonly color?: string
  readonly label?: string
}

export type JsonCanvas = {
  readonly nodes: ReadonlyArray<JsonCanvasNode>
  readonly edges: ReadonlyArray<JsonCanvasEdge>
}

const sizeOf = (n: CanvasNode): { w: number; h: number } => {
  const styleW = typeof n.style?.width === "number" ? (n.style.width as number) : null
  const styleH = typeof n.style?.height === "number" ? (n.style.height as number) : null
  return {
    w: n.width ?? styleW ?? (n.type === "group" ? 280 : 160),
    h: n.height ?? styleH ?? (n.type === "group" ? 200 : 60),
  }
}

const rfTypeToJsonCanvas = (n: CanvasNode): JsonCanvasNode["type"] => {
  if (n.type === "group") return "group"
  if (n.type === "link") return "link"
  if (n.type === "file") return "file"
  return "text"
}

export const toJsonCanvas = (snap: CanvasSnapshot): JsonCanvas => {
  const nodes: JsonCanvasNode[] = snap.nodes.map((n) => {
    const { w, h } = sizeOf(n)
    const out: { -readonly [K in keyof JsonCanvasNode]: JsonCanvasNode[K] } = {
      id: n.id,
      type: rfTypeToJsonCanvas(n),
      x: n.position.x,
      y: n.position.y,
      width: w,
      height: h,
    }
    const color = n.data?.color
    if (typeof color === "string" && color.length > 0) out.color = color
    const label = n.data?.label
    if (out.type === "text" && typeof label === "string") out.text = label
    if (out.type === "group" && typeof label === "string") out.label = label
    if (out.type === "link" && typeof n.data?.url === "string") out.url = n.data.url
    if (out.type === "file" && typeof n.data?.file === "string") out.file = n.data.file
    return out
  })

  const edges: JsonCanvasEdge[] = snap.edges.map((e) => {
    const data = (e as { data?: Record<string, unknown> }).data
    const arrow = normalizeArrow(data?.arrow)
    const out: { -readonly [K in keyof JsonCanvasEdge]: JsonCanvasEdge[K] } = {
      id: e.id,
      fromNode: e.source,
      toNode: e.target,
    }
    if (typeof e.sourceHandle === "string" && isSide(e.sourceHandle)) out.fromSide = e.sourceHandle
    if (typeof e.targetHandle === "string" && isSide(e.targetHandle)) out.toSide = e.targetHandle
    if (typeof e.label === "string") out.label = e.label
    if (typeof data?.color === "string" && data.color.length > 0) out.color = data.color as string
    if (arrow === "none") {
      out.fromEnd = "none"
      out.toEnd = "none"
    } else if (arrow === "both") {
      out.fromEnd = "arrow"
      out.toEnd = "arrow"
    } else {
      out.toEnd = "arrow"
    }
    return out
  })

  return { nodes, edges }
}

const isSide = (s: string): s is "top" | "right" | "bottom" | "left" =>
  s === "top" || s === "right" || s === "bottom" || s === "left"

export const fromJsonCanvas = (jc: JsonCanvas): CanvasSnapshot => {
  const nodes: CanvasNode[] = jc.nodes.map((n) => {
    const data: Record<string, unknown> = {}
    if (n.text !== undefined) data.label = n.text
    if (n.label !== undefined) data.label = n.label
    if (n.url !== undefined) data.url = n.url
    if (n.file !== undefined) data.file = n.file
    if (n.color !== undefined) data.color = n.color
    const rfType =
      n.type === "text" ? "box" : n.type === "group" ? "group" : n.type === "link" ? "link" : "file"
    const out: { -readonly [K in keyof CanvasNode]: CanvasNode[K] } = {
      id: n.id,
      type: rfType,
      position: { x: n.x, y: n.y },
      data,
      style: { width: n.width, height: n.height },
    }
    return out
  })
  const edges: CanvasEdge[] = jc.edges.map((e) => {
    const arrow: ArrowDirection =
      e.fromEnd === "arrow" && e.toEnd === "arrow"
        ? "both"
        : e.toEnd === "none" && e.fromEnd === "none"
          ? "none"
          : "forward"
    const data: Record<string, unknown> = { arrow }
    if (e.color !== undefined) data.color = e.color
    const out: { -readonly [K in keyof CanvasEdge]: CanvasEdge[K] } & {
      data?: Record<string, unknown>
    } = {
      id: e.id,
      source: e.fromNode,
      target: e.toNode,
    }
    if (e.fromSide !== undefined) out.sourceHandle = e.fromSide
    if (e.toSide !== undefined) out.targetHandle = e.toSide
    if (e.label !== undefined) out.label = e.label
    out.data = data
    return out
  })
  return { version: 1, updatedAt: new Date().toISOString(), nodes, edges }
}

export const parseJsonCanvas = (raw: string): JsonCanvas => {
  const obj = JSON.parse(raw)
  if (typeof obj !== "object" || obj === null) throw new Error("not an object")
  const o = obj as Record<string, unknown>
  const nodes = Array.isArray(o.nodes) ? (o.nodes as JsonCanvasNode[]) : []
  const edges = Array.isArray(o.edges) ? (o.edges as JsonCanvasEdge[]) : []
  return { nodes, edges }
}

export const serializeJsonCanvas = (jc: JsonCanvas): string => JSON.stringify(jc, null, 2)
