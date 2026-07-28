// Pure helpers for the brainstorms web feature — no React, no I/O — so the
// query key and the tab-key encoding are unit-testable (repo convention,
// mirrors pid-apps/pidApps.ts).

// Boards come in three on-disk formats. `canvas` is an Obsidian JSON Canvas
// file (`*.canvas`), `canvasJson` the legacy React-Flow encoding
// (`*.canvas.json`) kept readable for boards created before the switch, and
// `excalidraw` a native Excalidraw scene. The daemon discovers all three
// anywhere in the session's worktree.
export type BrainstormKind = "canvas" | "canvasJson" | "excalidraw"

// What a new board can be created as. The legacy encoding stays readable but is
// never written fresh.
export type CreatableBrainstormKind = "canvas" | "excalidraw"

export type BrainstormEditor = "canvas" | "excalidraw"

export type Brainstorm = {
  // Worktree-relative path — the board's identity everywhere. Moving the file
  // moves the board; nothing is keyed on a directory.
  readonly path: string
  readonly label: string
  readonly kind: BrainstormKind
  // Absolute path on the daemon's disk — shown to the user and handed to the
  // session's agent so it edits the same file the browser is drawing on.
  readonly file: string
  readonly updatedAt: string
}

const EDITOR_BY_KIND: Record<BrainstormKind, BrainstormEditor> = {
  canvas: "canvas",
  canvasJson: "canvas",
  excalidraw: "excalidraw",
}

export const brainstormEditorFor = (kind: BrainstormKind): BrainstormEditor => EDITOR_BY_KIND[kind]

// Session-scoped React Query key: boards for session A never collide with B.
export const brainstormsQueryKey = (short: string) => ["brainstorms", short] as const

export const BOARD_TAB_PREFIX = "brainstorm:"

/**
 * A board's `?tab=` value. The path is percent-encoded so its slashes survive
 * the round trip through the router's own search-param encoding — a raw
 * `brainstorm:brainstorms/a.canvas` would depend on how the router chooses to
 * escape "/" inside a value.
 */
export const boardTabKey = (path: string): string =>
  `${BOARD_TAB_PREFIX}${encodeURIComponent(path)}`

/** Inverse of boardTabKey; "" for a tab that selects no particular board. */
export const boardPathFromTabKey = (tab: string): string => {
  if (!tab.startsWith(BOARD_TAB_PREFIX)) return ""
  const raw = tab.slice(BOARD_TAB_PREFIX.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    // A hand-edited URL can carry a stray "%" — treat it as "no selection"
    // rather than throwing inside a render.
    return ""
  }
}

/**
 * Which board a `?tab=` value selects: the one it names while it still exists,
 * else the first board, else none. Keeps a deep link to a board that has since
 * been moved or deleted from rendering an empty panel.
 */
export const selectedBoard = (input: {
  readonly boards: readonly Brainstorm[]
  readonly tab: string
}): Brainstorm | null => {
  const path = boardPathFromTabKey(input.tab)
  return input.boards.find((b) => b.path === path) ?? input.boards[0] ?? null
}
