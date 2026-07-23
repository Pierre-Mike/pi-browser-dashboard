import type { Edge, Node } from "@xyflow/react"
import { type CanvasSnapshot, snapshotFromReactFlow } from "./canvas.types"

// Stable comparison body: drops `updatedAt` because the server stamps that
// field on every publish, so the same drawing keeps the same comparison key
// across round-trips. Two structurally-equal canvases serialize to the same
// string regardless of when they were last touched.
const stableBody = (snap: CanvasSnapshot): string =>
  JSON.stringify({ nodes: snap.nodes, edges: snap.edges, viewport: snap.viewport })

/**
 * Decide whether the locally-tracked canvas state diverges from the last value
 * we've synchronized with the server (either sent or received). The hook calls
 * this on every debounce tick to avoid chatting over the wire when nothing
 * actually changed.
 *
 * If `lastWire` is null we haven't seen a snapshot yet — sending now would
 * stomp on whatever the server already has. The hook waits for the first
 * inbound frame before letting upstream traffic flow.
 */
export const canvasShouldSend = (
  latest: CanvasSnapshot,
  lastWire: CanvasSnapshot | null,
): boolean => {
  if (lastWire === null) return false
  return stableBody(latest) !== stableBody(lastWire)
}

export const canvasStableKey = (snap: CanvasSnapshot): string => stableBody(snap)

/**
 * Wire snapshot → React Flow state. Everything the wire carries must land on
 * the React Flow objects — edge `label` and `data` included, since the label
 * chip and the arrow/color toolbar read them back from there.
 */
export const snapshotToReactFlow = (snap: CanvasSnapshot): { nodes: Node[]; edges: Edge[] } => ({
  nodes: snap.nodes.map((n) => {
    const node: Node = {
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
      data: (n.data ?? { label: n.id }) as Record<string, unknown>,
    }
    if (n.type !== undefined) node.type = n.type
    if (n.parentId !== undefined) node.parentId = n.parentId
    if (n.extent !== undefined) node.extent = n.extent
    if (n.style !== undefined) node.style = n.style as Record<string, string | number>
    return node
  }),
  edges: snap.edges.map((e) => {
    const edge: Edge = { id: e.id, source: e.source, target: e.target }
    if (e.type !== undefined) edge.type = e.type
    if (e.label !== undefined) edge.label = e.label
    if (e.animated !== undefined) edge.animated = e.animated
    if (e.sourceHandle !== undefined) edge.sourceHandle = e.sourceHandle
    if (e.targetHandle !== undefined) edge.targetHandle = e.targetHandle
    if (e.data !== undefined) edge.data = e.data as Record<string, unknown>
    return edge
  }),
})

/**
 * React Flow state → wire snapshot. The inverse of snapshotToReactFlow; used
 * both to publish live edits upstream and to export a .canvas file, so any
 * field dropped here is a field the user loses.
 */
export const reactFlowToSnapshot = (args: {
  readonly nodes: ReadonlyArray<Node>
  readonly edges: ReadonlyArray<Edge>
}): CanvasSnapshot =>
  snapshotFromReactFlow({
    nodes: args.nodes.map((n) => ({
      id: n.id,
      position: n.position,
      type: n.type,
      data: n.data as Record<string, unknown> | undefined,
      width: n.width ?? n.measured?.width ?? null,
      height: n.height ?? n.measured?.height ?? null,
      parentId: n.parentId ?? null,
      extent: n.extent,
      style: (n.style ?? null) as Record<string, unknown> | null,
    })),
    edges: args.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      label: typeof e.label === "string" ? e.label : undefined,
      animated: e.animated,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      data: (e.data ?? undefined) as Record<string, unknown> | undefined,
    })),
  })
