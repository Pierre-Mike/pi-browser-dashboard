// Mirror of the daemon-side CanvasSnapshot. We don't import from `@pid/daemon`
// because the React Flow types diverge slightly (`Node`/`Edge` from
// `@xyflow/react` carry their own generics), but the wire shape is identical.

export type CanvasPosition = { readonly x: number; readonly y: number }

export type CanvasNode = {
  readonly id: string
  readonly position: CanvasPosition
  readonly type?: string
  readonly data?: Record<string, unknown>
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

export type ServerFrame =
  | {
      readonly kind: "snapshot"
      readonly snapshot: CanvasSnapshot
      readonly origin: "self" | "remote"
    }
  | { readonly kind: "error"; readonly message: string }

export type ClientFrame =
  | { readonly kind: "snapshot"; readonly snapshot: CanvasSnapshot }
  | { readonly kind: "request" }

export const emptyCanvas = (): CanvasSnapshot => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  nodes: [],
  edges: [],
})

/**
 * Strip transient React Flow keys we don't want to persist (selection state,
 * drag handles, computed positions during a drag). The daemon parser drops
 * unknown keys anyway, but doing it client-side keeps the round-trip payload
 * small and matches the schema in canvas.types.ts exactly.
 */
export const snapshotFromReactFlow = (args: {
  readonly nodes: ReadonlyArray<{
    id: string
    position: CanvasPosition
    type?: string
    data?: Record<string, unknown>
    width?: number | null
    height?: number | null
  }>
  readonly edges: ReadonlyArray<{
    id: string
    source: string
    target: string
    type?: string
    label?: string | undefined
    animated?: boolean
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
  readonly viewport?: CanvasViewport
}): CanvasSnapshot => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  nodes: args.nodes.map((n) => {
    const out: { -readonly [K in keyof CanvasNode]: CanvasNode[K] } = {
      id: n.id,
      position: n.position,
    }
    if (n.type !== undefined) out.type = n.type
    if (n.data !== undefined) out.data = n.data
    if (typeof n.width === "number") out.width = n.width
    if (typeof n.height === "number") out.height = n.height
    return out
  }),
  edges: args.edges.map((e) => {
    const out: { -readonly [K in keyof CanvasEdge]: CanvasEdge[K] } = {
      id: e.id,
      source: e.source,
      target: e.target,
    }
    if (e.type !== undefined) out.type = e.type
    if (typeof e.label === "string") out.label = e.label
    if (typeof e.animated === "boolean") out.animated = e.animated
    if (typeof e.sourceHandle === "string") out.sourceHandle = e.sourceHandle
    if (typeof e.targetHandle === "string") out.targetHandle = e.targetHandle
    return out
  }),
  ...(args.viewport ? { viewport: args.viewport } : {}),
})
