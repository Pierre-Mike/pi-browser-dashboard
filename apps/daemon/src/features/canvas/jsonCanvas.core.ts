// Obsidian JSON Canvas (`.canvas`) codec, in and out of the daemon's
// React-Flow CanvasSnapshot.
//
// `.canvas` is the format the brainstorm board now stores by default: it is an
// open spec (jsoncanvas.org), Obsidian opens it, agents write it with plain file
// tools, and it diffs readably in git. The wire shape stays CanvasSnapshot, so
// the browser editor and the live-sync socket are identical for a `.canvas` and
// a legacy `.canvas.json` document — only the bytes on disk differ.
//
// The mapping mirrors the browser's import/export helpers
// (apps/web/src/features/canvas/canvasObsidian.ts) so a board drawn here and a
// board exported from the UI describe the same file.

import { Either } from "effect"
import type { CanvasEdge, CanvasNode, CanvasSnapshot } from "./canvas.core"

export type JsonCanvasNodeType = "text" | "group" | "link" | "file"
export type JsonCanvasSide = "top" | "right" | "bottom" | "left"
export type JsonCanvasEnd = "none" | "arrow"

export type JsonCanvasNode = {
  readonly id: string
  readonly type: JsonCanvasNodeType
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly color?: string
  readonly text?: string
  readonly label?: string
  readonly url?: string
  readonly file?: string
}

export type JsonCanvasEdge = {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly fromSide?: JsonCanvasSide
  readonly toSide?: JsonCanvasSide
  readonly fromEnd?: JsonCanvasEnd
  readonly toEnd?: JsonCanvasEnd
  readonly color?: string
  readonly label?: string
}

export type JsonCanvas = {
  readonly nodes: readonly JsonCanvasNode[]
  readonly edges: readonly JsonCanvasEdge[]
}

type ArrowDirection = "forward" | "both" | "none"

// A `.canvas` file has nowhere to record a modification time, so a decoded
// document carries the epoch and the room stamps the live snapshot instead.
const EPOCH_ISO = "1970-01-01T00:00:00.000Z"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

// ── Obsidian → CanvasSnapshot ───────────────────────────────────────────────

const RF_TYPE: Record<string, string> = {
  text: "box",
  group: "group",
  link: "link",
  file: "file",
}

// Obsidian's per-type payload keys and where they land in React Flow's
// `data`: a text node's body and a group's caption both read as the label.
const DATA_KEYS: readonly (readonly [string, string])[] = [
  ["text", "label"],
  ["label", "label"],
  ["url", "url"],
  ["file", "file"],
  ["color", "color"],
]

const nodeData = (raw: Record<string, unknown>): Record<string, unknown> => {
  const data: Record<string, unknown> = {}
  for (const [from, to] of DATA_KEYS) {
    const value = raw[from]
    if (isStr(value)) data[to] = value
  }
  return data
}

const nodeStyle = (raw: Record<string, unknown>): Record<string, number> | null =>
  isNum(raw.width) && isNum(raw.height) ? { width: raw.width, height: raw.height } : null

const parseNode = (raw: unknown): CanvasNode | null => {
  if (!isObj(raw)) return null
  if (!isStr(raw.id) || raw.id.length === 0) return null
  if (!isNum(raw.x) || !isNum(raw.y)) return null
  const style = nodeStyle(raw)
  const node: { -readonly [K in keyof CanvasNode]: CanvasNode[K] } = {
    id: raw.id,
    type: RF_TYPE[isStr(raw.type) ? raw.type : "text"] ?? "box",
    position: { x: raw.x, y: raw.y },
    data: nodeData(raw),
  }
  if (style !== null) node.style = style
  return node
}

const asSide = (v: unknown): JsonCanvasSide | undefined =>
  v === "top" || v === "right" || v === "bottom" || v === "left" ? v : undefined

// Obsidian records arrowheads per end; React Flow carries one direction.
const arrowFromEnds = (raw: Record<string, unknown>): ArrowDirection => {
  if (raw.fromEnd === "arrow" && raw.toEnd === "arrow") return "both"
  if (raw.fromEnd === "none" && raw.toEnd === "none") return "none"
  return "forward"
}

const edgeData = (raw: Record<string, unknown>): Record<string, unknown> => {
  const data: Record<string, unknown> = { arrow: arrowFromEnds(raw) }
  if (isStr(raw.color)) data.color = raw.color
  return data
}

const parseEdge = (raw: unknown): CanvasEdge | null => {
  if (!isObj(raw)) return null
  if (!isStr(raw.id) || raw.id.length === 0) return null
  if (!isStr(raw.fromNode) || !isStr(raw.toNode)) return null
  const edge: { -readonly [K in keyof CanvasEdge]: CanvasEdge[K] } = {
    id: raw.id,
    source: raw.fromNode,
    target: raw.toNode,
  }
  const fromSide = asSide(raw.fromSide)
  const toSide = asSide(raw.toSide)
  if (fromSide) edge.sourceHandle = fromSide
  if (toSide) edge.targetHandle = toSide
  if (isStr(raw.label)) edge.label = raw.label
  edge.data = edgeData(raw)
  return edge
}

const parseList = <A>(input: {
  readonly raw: unknown
  readonly parse: (item: unknown) => A | null
}): readonly A[] =>
  Array.isArray(input.raw)
    ? input.raw.map(input.parse).filter((item): item is A => item !== null)
    : []

/**
 * Decode a `.canvas` document into a CanvasSnapshot. Malformed nodes and edges
 * are dropped rather than failing the whole board (an agent mid-write, a
 * hand-edited file); a root that is not an object at all is a `Left`, because
 * quietly substituting an empty canvas would lose the user's drawing.
 */
export const parseJsonCanvas = (raw: unknown): Either.Either<CanvasSnapshot, string> => {
  if (!isObj(raw)) return Either.left("json canvas: root must be an object")
  return Either.right({
    version: 1,
    updatedAt: EPOCH_ISO,
    nodes: parseList({ raw: raw.nodes, parse: parseNode }),
    edges: parseList({ raw: raw.edges, parse: parseEdge }),
  })
}

// ── CanvasSnapshot → Obsidian ───────────────────────────────────────────────

const JSON_CANVAS_TYPE: Record<string, JsonCanvasNodeType> = {
  group: "group",
  link: "link",
  file: "file",
}

// Inverse of DATA_KEYS: which `data` key carries this node type's payload, and
// which Obsidian key it is written to.
const PAYLOAD_KEYS: Record<JsonCanvasNodeType, readonly [string, string]> = {
  text: ["label", "text"],
  group: ["label", "label"],
  link: ["url", "url"],
  file: ["file", "file"],
}

// Obsidian sizes every node explicitly. React Flow's top-level width/height are
// measured outputs and a group's authoritative size lives in `style`, so try
// both before falling back to the default box a fresh node is drawn at.
const pickSize = (input: {
  readonly candidates: readonly unknown[]
  readonly fallback: number
}): number => input.candidates.find(isNum) ?? input.fallback

const sizeOf = (n: CanvasNode): { readonly width: number; readonly height: number } => {
  const style = n.style ?? {}
  const isGroup = n.type === "group"
  return {
    width: pickSize({ candidates: [n.width, style.width], fallback: isGroup ? 280 : 160 }),
    height: pickSize({ candidates: [n.height, style.height], fallback: isGroup ? 200 : 60 }),
  }
}

const payloadOf = (input: {
  readonly type: JsonCanvasNodeType
  readonly data: Readonly<Record<string, unknown>>
}): Record<string, string> => {
  const [from, to] = PAYLOAD_KEYS[input.type]
  const value = input.data[from]
  return isStr(value) ? { [to]: value } : {}
}

const toJsonCanvasNode = (n: CanvasNode): JsonCanvasNode => {
  const type = JSON_CANVAS_TYPE[n.type ?? ""] ?? "text"
  const data = n.data ?? {}
  const color = data.color
  return {
    id: n.id,
    type,
    x: n.position.x,
    y: n.position.y,
    ...sizeOf(n),
    ...(isStr(color) && color.length > 0 ? { color } : {}),
    ...payloadOf({ type, data }),
  }
}

const ENDS: Record<ArrowDirection, Pick<JsonCanvasEdge, "fromEnd" | "toEnd">> = {
  forward: { toEnd: "arrow" },
  both: { fromEnd: "arrow", toEnd: "arrow" },
  none: { fromEnd: "none", toEnd: "none" },
}

const arrowOf = (v: unknown): ArrowDirection => (v === "both" || v === "none" ? v : "forward")

const toJsonCanvasEdge = (e: CanvasEdge): JsonCanvasEdge => {
  const data = e.data ?? {}
  const color = data.color
  const fromSide = asSide(e.sourceHandle)
  const toSide = asSide(e.targetHandle)
  return {
    id: e.id,
    fromNode: e.source,
    toNode: e.target,
    ...(fromSide ? { fromSide } : {}),
    ...(toSide ? { toSide } : {}),
    ...(isStr(e.label) ? { label: e.label } : {}),
    ...(isStr(color) && color.length > 0 ? { color } : {}),
    ...ENDS[arrowOf(data.arrow)],
  }
}

export const toJsonCanvas = (snap: CanvasSnapshot): JsonCanvas => ({
  nodes: snap.nodes.map(toJsonCanvasNode),
  edges: snap.edges.map(toJsonCanvasEdge),
})

// Two spaces, and no `updatedAt` key: the file is meant to be read, diffed and
// hand-edited, and a mtime already lives in the filesystem.
export const serializeJsonCanvas = (snap: CanvasSnapshot): string =>
  JSON.stringify(toJsonCanvas(snap), null, 2)

/**
 * Structural equality as the *file* sees it. Deliberately compares the encoded
 * document rather than the snapshot, so the room's "did this change?" check
 * ignores an `updatedAt` that is never persisted — otherwise every stamp would
 * look like an external edit and echo back to every connected tab.
 */
export const jsonCanvasEqual = (input: {
  readonly a: CanvasSnapshot
  readonly b: CanvasSnapshot
}): boolean => serializeJsonCanvas(input.a) === serializeJsonCanvas(input.b)

export const emptyJsonCanvas = (): CanvasSnapshot => ({
  version: 1,
  updatedAt: EPOCH_ISO,
  nodes: [],
  edges: [],
})
