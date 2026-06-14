// Pure helpers for the canvas's direct-manipulation interactions, kept out of
// the React components so the geometry/parsing stays unit-testable:
//  - double-click empty space drops a box (Obsidian Canvas parity)
//  - new link nodes default to the project's own local URL
//  - file nodes can be filled from a native system file picker

export type FlowPoint = { x: number; y: number }

// Default footprint for a freshly dropped box. Matches the toolbar "+ Box"
// size so resize handles and snapping behave identically however it was made.
export const BOX_DEFAULT_WIDTH = 160
export const BOX_DEFAULT_HEIGHT = 60

export type NewBox = {
  id: string
  type: "box"
  position: FlowPoint
  data: { label: string }
  style: { width: number; height: number }
  selected: true
}

/**
 * Build a box centered on a flow-space point. Obsidian drops a new card under
 * the cursor on double-click; we mirror that — centered, selected, and with an
 * empty label so the editable box opens straight into edit mode.
 */
export const newBoxAt = (point: FlowPoint, id: string): NewBox => ({
  id,
  type: "box",
  position: {
    x: Math.round(point.x - BOX_DEFAULT_WIDTH / 2),
    y: Math.round(point.y - BOX_DEFAULT_HEIGHT / 2),
  },
  data: { label: "" },
  style: { width: BOX_DEFAULT_WIDTH, height: BOX_DEFAULT_HEIGHT },
  selected: true,
})

// React Flow stamps the empty background surface with this class. A double-click
// whose direct target carries it means the user hit empty space (not a node,
// handle, edge, or control), which is when we want to drop a box.
const PANE_CLASS = "react-flow__pane"

/**
 * Whether a double-click target's className marks the empty pane. We read the
 * raw className string rather than walking the DOM so this stays pure. SVG
 * targets expose className as an object (SVGAnimatedString), never a string,
 * so they correctly read as "not the pane".
 */
export const isPaneClassName = (className: unknown): boolean =>
  typeof className === "string" && className.split(/\s+/).includes(PANE_CLASS)

/**
 * Default URL for a new link node: the project's own origin. The canvas lives
 * inside the dashboard, so "local first" means a fresh link points at the
 * running app's root, which the user then extends to a concrete path.
 */
export const defaultLinkUrl = (origin: string): string => {
  const trimmed = origin.trim().replace(/\/+$/, "")
  return trimmed ? `${trimmed}/` : ""
}

/**
 * Pull the reference to store from a native file picker's FileList. We keep
 * just the file name (the browser can't expose a full path), matching how
 * Obsidian stores vault-relative file references.
 */
export const pickedFileRef = (
  files: ArrayLike<{ name: string }> | null | undefined,
): string | null => {
  const first = files && files.length > 0 ? files[0] : null
  return first ? first.name : null
}
