// Pure helpers for the read-only .canvas file preview. Lives next to the
// FileTree (the only caller) so the canvas/ feature stays focused on the live
// editor. We import the JSON Canvas <-> snapshot converters from the canvas
// feature and add the React-Flow decoration step (default node type, arrow
// markers) that the editor does inline.

import { MarkerType } from "@xyflow/react"
import type { CanvasEdge, CanvasNode, CanvasSnapshot } from "../canvas/canvas.types"
import {
  type ArrowDirection,
  colorFor,
  fromJsonCanvas,
  normalizeArrow,
  parseJsonCanvas,
} from "../canvas/canvasObsidian"

export type RFNode = {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  width?: number
  height?: number
  style?: Record<string, unknown>
  parentId?: string
  extent?: "parent"
  draggable: false
  connectable: false
  selectable: true
}

export type RFEdge = {
  id: string
  source: string
  target: string
  label?: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
  markerStart?: { type: MarkerType; width: number; height: number; color?: string }
  markerEnd?: { type: MarkerType; width: number; height: number; color?: string }
  style?: Record<string, unknown>
  labelStyle?: Record<string, unknown>
}

const defaultNodeType = (t: string | undefined): string => {
  if (t === "group" || t === "link" || t === "file") return t
  return "box"
}

export const snapshotToReactFlowNodes = (snap: CanvasSnapshot): RFNode[] =>
  snap.nodes.map((n: CanvasNode): RFNode => {
    const out: RFNode = {
      id: n.id,
      type: defaultNodeType(n.type),
      position: { x: n.position.x, y: n.position.y },
      data: { ...(n.data ?? {}) },
      draggable: false,
      connectable: false,
      selectable: true,
    }
    if (typeof n.width === "number") out.width = n.width
    if (typeof n.height === "number") out.height = n.height
    if (n.style && typeof n.style === "object") out.style = { ...n.style }
    if (typeof n.parentId === "string" && n.parentId.length > 0) out.parentId = n.parentId
    if (n.extent === "parent") out.extent = "parent"
    return out
  })

export const decorateCanvasEdge = (e: CanvasEdge): RFEdge => {
  const data = e.data ?? {}
  const arrow: ArrowDirection = normalizeArrow(data.arrow)
  const color = typeof data.color === "string" ? data.color : ""
  const palette = colorFor(color)
  const stroke = palette.stroke || undefined

  const out: RFEdge = {
    id: e.id,
    source: e.source,
    target: e.target,
  }
  if (typeof e.label === "string") out.label = e.label
  if (typeof e.sourceHandle === "string") out.sourceHandle = e.sourceHandle
  if (typeof e.targetHandle === "string") out.targetHandle = e.targetHandle
  if (e.data) out.data = { ...e.data }

  if (arrow !== "none") {
    out.markerEnd = {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      ...(stroke ? { color: stroke } : {}),
    }
  }
  if (arrow === "both") {
    out.markerStart = {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      ...(stroke ? { color: stroke } : {}),
    }
  }
  if (stroke) {
    out.style = { stroke }
    out.labelStyle = { fill: stroke }
  }
  return out
}

export const snapshotToReactFlowEdges = (snap: CanvasSnapshot): RFEdge[] =>
  snap.edges.map(decorateCanvasEdge)

export type CanvasParseResult =
  | { readonly ok: true; readonly snapshot: CanvasSnapshot }
  | { readonly ok: false; readonly error: string }

export const parseCanvasFile = (raw: string): CanvasParseResult => {
  try {
    const jc = parseJsonCanvas(raw)
    return { ok: true, snapshot: fromJsonCanvas(jc) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
