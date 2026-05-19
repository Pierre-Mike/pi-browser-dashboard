// Pure helpers for the layout/arrangement features in the canvas: alignment
// of a multi-selection, even distribution along an axis, and snap-to-grid.
// Kept side-effect free so we can unit-test them without React Flow.

export type ArrangeableNode = {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly width?: number | null
  readonly height?: number | null
  readonly selected?: boolean
  readonly data?: Record<string, unknown>
}

export type Axis = "left" | "right" | "top" | "bottom" | "centerX" | "centerY"

const w = (n: ArrangeableNode): number => n.width ?? 160
const h = (n: ArrangeableNode): number => n.height ?? 60

/**
 * Align the given selection along `axis`. Returns a new array with selected
 * nodes repositioned; unselected nodes pass through unchanged.
 *
 * - left  : same min-x
 * - right : same max-x (right edge)
 * - top   : same min-y
 * - bottom: same max-y (bottom edge)
 * - centerX: same horizontal midpoint
 * - centerY: same vertical midpoint
 */
export const alignNodes = (
  nodes: ReadonlyArray<ArrangeableNode>,
  selectedIds: ReadonlyArray<string>,
  axis: Axis,
): ReadonlyArray<ArrangeableNode> => {
  const sel = new Set(selectedIds)
  const targets = nodes.filter((n) => sel.has(n.id))
  if (targets.length < 2) return nodes

  let anchor = 0
  switch (axis) {
    case "left":
      anchor = Math.min(...targets.map((n) => n.position.x))
      break
    case "right":
      anchor = Math.max(...targets.map((n) => n.position.x + w(n)))
      break
    case "top":
      anchor = Math.min(...targets.map((n) => n.position.y))
      break
    case "bottom":
      anchor = Math.max(...targets.map((n) => n.position.y + h(n)))
      break
    case "centerX":
      anchor = targets.reduce((sum, n) => sum + n.position.x + w(n) / 2, 0) / targets.length
      break
    case "centerY":
      anchor = targets.reduce((sum, n) => sum + n.position.y + h(n) / 2, 0) / targets.length
      break
  }

  return nodes.map((n) => {
    if (!sel.has(n.id)) return n
    let { x, y } = n.position
    switch (axis) {
      case "left":
        x = anchor
        break
      case "right":
        x = anchor - w(n)
        break
      case "top":
        y = anchor
        break
      case "bottom":
        y = anchor - h(n)
        break
      case "centerX":
        x = anchor - w(n) / 2
        break
      case "centerY":
        y = anchor - h(n) / 2
        break
    }
    return { ...n, position: { x, y } }
  })
}

/**
 * Distribute the selected nodes evenly along the given axis. Requires at
 * least three nodes — the two outermost are anchors and the rest get evenly
 * spaced between them by midpoint.
 */
export const distributeNodes = (
  nodes: ReadonlyArray<ArrangeableNode>,
  selectedIds: ReadonlyArray<string>,
  axis: "horizontal" | "vertical",
): ReadonlyArray<ArrangeableNode> => {
  const sel = new Set(selectedIds)
  const targets = nodes.filter((n) => sel.has(n.id))
  if (targets.length < 3) return nodes

  const mid = (n: ArrangeableNode) =>
    axis === "horizontal" ? n.position.x + w(n) / 2 : n.position.y + h(n) / 2

  const sorted = [...targets].sort((a, b) => mid(a) - mid(b))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last) return nodes
  const lo = mid(first)
  const hi = mid(last)
  const step = (hi - lo) / (sorted.length - 1)

  const adjustment = new Map<string, { x: number; y: number }>()
  sorted.forEach((n, i) => {
    if (i === 0 || i === sorted.length - 1) return
    const targetMid = lo + step * i
    if (axis === "horizontal") {
      adjustment.set(n.id, { x: targetMid - w(n) / 2, y: n.position.y })
    } else {
      adjustment.set(n.id, { x: n.position.x, y: targetMid - h(n) / 2 })
    }
  })

  return nodes.map((n) => {
    const a = adjustment.get(n.id)
    return a ? { ...n, position: a } : n
  })
}

/**
 * Snap a coordinate to the nearest grid step. Pass step = 0 to disable.
 */
export const snapToGrid = (
  pos: { readonly x: number; readonly y: number },
  step: number,
): { x: number; y: number } => {
  if (step <= 0) return { x: pos.x, y: pos.y }
  return {
    x: Math.round(pos.x / step) * step,
    y: Math.round(pos.y / step) * step,
  }
}

/**
 * Find the first node whose label (text or url or file) contains the query
 * case-insensitively. Returns the node id, or null.
 */
export const findFirstMatch = (
  nodes: ReadonlyArray<ArrangeableNode>,
  query: string,
): string | null => {
  const q = query.trim().toLowerCase()
  if (!q) return null
  for (const n of nodes) {
    const data = n.data ?? {}
    const haystack = [
      typeof data.label === "string" ? data.label : "",
      typeof data.url === "string" ? data.url : "",
      typeof data.file === "string" ? data.file : "",
    ]
      .join(" ")
      .toLowerCase()
    if (haystack.includes(q)) return n.id
  }
  return null
}
