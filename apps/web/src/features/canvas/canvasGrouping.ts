// Pure helpers for the "group selected boxes under one big box" interaction.
// We model nodes with the minimum surface the UI cares about so this file can
// be unit-tested without dragging in React Flow's full Node generic.
//
// Coordinate model: when a node has a `parentId`, its `position` is relative
// to that parent. When it doesn't, the position is in canvas space. The
// helpers convert between the two so a group can be created from a flat
// selection and undone back to flat coordinates.

export type GroupableNode = {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly type?: string
  readonly parentId?: string
  readonly extent?: "parent"
  readonly width?: number | null
  readonly height?: number | null
  readonly measuredWidth?: number | null
  readonly measuredHeight?: number | null
  readonly data?: Record<string, unknown>
  readonly style?: Record<string, unknown>
}

const DEFAULT_BOX_W = 160
const DEFAULT_BOX_H = 40
const GROUP_PADDING = 28
const GROUP_LABEL_GUTTER = 14

const sizeOf = (n: GroupableNode): { w: number; h: number } => ({
  w: n.width ?? n.measuredWidth ?? DEFAULT_BOX_W,
  h: n.height ?? n.measuredHeight ?? DEFAULT_BOX_H,
})

const absolutePosition = (
  n: GroupableNode,
  byId: ReadonlyMap<string, GroupableNode>,
): { x: number; y: number } => {
  let x = n.position.x
  let y = n.position.y
  let parentId = n.parentId
  // Walk up parents, accumulating offsets. We bound the walk so a self-cycle
  // (which shouldn't be reachable, but is cheap to defend against) can't loop.
  for (let i = 0; i < 16 && parentId; i++) {
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentId
  }
  return { x, y }
}

const newGroupId = (existing: ReadonlyArray<GroupableNode>): string => {
  const taken = new Set(existing.map((n) => n.id))
  let i = 1
  for (;;) {
    const candidate = `g-${Date.now().toString(36)}-${i}`
    if (!taken.has(candidate)) return candidate
    i += 1
  }
}

export type GroupResult = {
  readonly nodes: ReadonlyArray<GroupableNode>
  readonly groupId: string | null
}

/**
 * Wrap the given selection under a freshly-created group node. Returns the
 * updated node list and the new group's id, or `{ nodes, groupId: null }` if
 * the selection is empty or every selected node is already inside the same
 * parent (in which case grouping would be a no-op).
 *
 * Nested groups are intentionally not supported in this MVP — if any selected
 * node is itself a group or already has a parent, it's left in place so the
 * caller can show feedback. We still proceed with the rest.
 */
export const groupSelected = (
  nodes: ReadonlyArray<GroupableNode>,
  selectedIds: ReadonlyArray<string>,
  opts: { readonly label?: string; readonly groupId?: string } = {},
): GroupResult => {
  if (selectedIds.length === 0) return { nodes, groupId: null }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const selection = selectedIds
    .map((id) => byId.get(id))
    .filter((n): n is GroupableNode => !!n && n.type !== "group" && !n.parentId)
  if (selection.length < 1) return { nodes, groupId: null }

  // Compute absolute bounding box of the selection.
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of selection) {
    const { x, y } = absolutePosition(n, byId)
    const { w, h } = sizeOf(n)
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x + w > maxX) maxX = x + w
    if (y + h > maxY) maxY = y + h
  }

  const groupX = minX - GROUP_PADDING
  const groupY = minY - GROUP_PADDING - GROUP_LABEL_GUTTER
  const groupW = maxX - minX + GROUP_PADDING * 2
  const groupH = maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_GUTTER

  const groupId = opts.groupId ?? newGroupId(nodes)
  const groupNode: GroupableNode = {
    id: groupId,
    type: "group",
    position: { x: groupX, y: groupY },
    data: { label: opts.label ?? "Group" },
    style: { width: groupW, height: groupH },
  }

  const selectionIds = new Set(selection.map((n) => n.id))
  const rewritten = nodes.map((n) => {
    if (!selectionIds.has(n.id)) return n
    const { x, y } = absolutePosition(n, byId)
    return {
      ...n,
      parentId: groupId,
      extent: "parent" as const,
      position: { x: x - groupX, y: y - groupY },
    }
  })

  // The group node must appear BEFORE its children in the array — React Flow
  // requires this ordering to lay children inside the parent on first render.
  return { nodes: [groupNode, ...rewritten], groupId }
}

/**
 * Inverse of groupSelected: remove a group node and re-parent its children to
 * the canvas. Children's positions are converted back to absolute so the
 * layout doesn't visually jump.
 */
export const ungroupNode = (
  nodes: ReadonlyArray<GroupableNode>,
  groupId: string,
): ReadonlyArray<GroupableNode> => {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const group = byId.get(groupId)
  if (!group || group.type !== "group") return nodes

  return nodes
    .filter((n) => n.id !== groupId)
    .map((n) => {
      if (n.parentId !== groupId) return n
      const abs = {
        x: n.position.x + group.position.x,
        y: n.position.y + group.position.y,
      }
      const { parentId: _p, extent: _e, ...rest } = n
      return { ...rest, position: abs }
    })
}
