import path from "node:path"

// Wire format of the canvas snapshot. Mirrors the React Flow shape so the
// browser side can pass nodes/edges through with no remapping. We only persist
// the fields we explicitly know about — extra keys are dropped on parse to keep
// stored canvases forward-compatible without smuggling in unknown junk.

export type CanvasPosition = { readonly x: number; readonly y: number }

export type CanvasNode = {
  readonly id: string
  readonly position: CanvasPosition
  readonly type?: string
  readonly data?: Readonly<Record<string, unknown>>
  readonly width?: number
  readonly height?: number
}

export type CanvasEdge = {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly type?: string
  readonly label?: string
  readonly animated?: boolean
  readonly sourceHandle?: string
  readonly targetHandle?: string
}

export type CanvasViewport = {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export type CanvasSnapshot = {
  readonly version: 1
  readonly updatedAt: string
  readonly nodes: ReadonlyArray<CanvasNode>
  readonly edges: ReadonlyArray<CanvasEdge>
  readonly viewport?: CanvasViewport
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

const parsePosition = (v: unknown): CanvasPosition | null => {
  if (!isObj(v)) return null
  if (!isNum(v.x) || !isNum(v.y)) return null
  return { x: v.x, y: v.y }
}

const parseNode = (v: unknown): CanvasNode | null => {
  if (!isObj(v)) return null
  if (!isStr(v.id) || v.id.length === 0) return null
  const position = parsePosition(v.position)
  if (!position) return null
  const node: { -readonly [K in keyof CanvasNode]: CanvasNode[K] } = { id: v.id, position }
  if (isStr(v.type)) node.type = v.type
  if (isObj(v.data)) node.data = v.data
  if (isNum(v.width)) node.width = v.width
  if (isNum(v.height)) node.height = v.height
  return node
}

const parseEdge = (v: unknown): CanvasEdge | null => {
  if (!isObj(v)) return null
  if (!isStr(v.id) || v.id.length === 0) return null
  if (!isStr(v.source) || !isStr(v.target)) return null
  const edge: { -readonly [K in keyof CanvasEdge]: CanvasEdge[K] } = {
    id: v.id,
    source: v.source,
    target: v.target,
  }
  if (isStr(v.type)) edge.type = v.type
  if (isStr(v.label)) edge.label = v.label
  if (typeof v.animated === "boolean") edge.animated = v.animated
  if (isStr(v.sourceHandle)) edge.sourceHandle = v.sourceHandle
  if (isStr(v.targetHandle)) edge.targetHandle = v.targetHandle
  return edge
}

const parseViewport = (v: unknown): CanvasViewport | undefined => {
  if (!isObj(v)) return undefined
  if (!isNum(v.x) || !isNum(v.y) || !isNum(v.zoom)) return undefined
  return { x: v.x, y: v.y, zoom: v.zoom }
}

/**
 * Parse arbitrary JSON into a CanvasSnapshot, silently dropping malformed nodes
 * or edges instead of failing the whole document. We *do* throw if the root
 * isn't an object at all — that's a strong signal of a corrupted file or a
 * caller passing garbage, and falling back to an empty canvas would silently
 * lose the user's drawing.
 */
export const parseCanvas = (json: unknown): CanvasSnapshot => {
  if (!isObj(json)) throw new Error("canvas: root must be an object")
  const nodes = Array.isArray(json.nodes)
    ? (json.nodes.map(parseNode).filter((n): n is CanvasNode => n !== null) as CanvasNode[])
    : []
  const edges = Array.isArray(json.edges)
    ? (json.edges.map(parseEdge).filter((e): e is CanvasEdge => e !== null) as CanvasEdge[])
    : []
  const updatedAt = isStr(json.updatedAt) ? json.updatedAt : new Date(0).toISOString()
  const viewport = parseViewport(json.viewport)
  return viewport
    ? { version: 1, updatedAt, nodes, edges, viewport }
    : { version: 1, updatedAt, nodes, edges }
}

export const emptyCanvas = (): CanvasSnapshot => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  nodes: [],
  edges: [],
})

export const canvasPathFor = (configDir: string, short: string): string =>
  path.join(configDir, "jobs", short, "canvas.json")

/**
 * Stable structural-equality check. We use this to suppress no-op broadcasts
 * after the file watcher fires for our *own* writes: if the disk content is
 * byte-identical to what's already in the cache, there's nothing new to push.
 */
export const canvasEqual = (a: CanvasSnapshot, b: CanvasSnapshot): boolean =>
  serializeCanvas(a) === serializeCanvas(b)

export const serializeCanvas = (snap: CanvasSnapshot): string => JSON.stringify(snap, null, 2)
