// Pure helpers backing the file-tree's create / rename / move operations. No
// I/O and no @pierre/trees coupling — the imperative wiring in FileTree.tsx
// calls these to compute paths and validate names, and they are unit-tested
// directly (the shadow-DOM tree itself can't be driven from jsdom).

import { basenameOf } from "./fileKind"
import { joinPath, parentOf } from "./treeUtil"

// Validate a single path segment a user typed for a new/renamed entry. Returns
// a human-readable reason when invalid, or null when the name is acceptable.
// Mirrors the daemon's traversal guard (no separators, no "."/".."), caught
// client-side so the user gets immediate feedback before the request.
export const fsNameError = (name: string): string | null => {
  const n = name.trim()
  if (n === "") return "Name can’t be empty"
  if (n === "." || n === "..") return "Reserved name"
  if (n.includes("/")) return "Name can’t contain “/”"
  if (n.includes("\\")) return "Name can’t contain “\\”"
  if (n.includes("\0")) return "Invalid character"
  return null
}

export type TreeItem = { readonly path: string; readonly kind: "file" | "directory" }

// @pierre/trees canonicalises directory paths with a trailing "/"
// (isCanonicalDirectoryPath === endsWith("/")). The daemon wants a clean
// relative path, so strip it before any path math.
export const stripSlash = (p: string): string => (p.endsWith("/") ? p.slice(0, -1) : p)

// Where a new entry lands given the right-clicked row: inside a directory, or
// alongside a file (its parent directory) — matching common file-explorer UX.
export const createTargetPath = (item: TreeItem, name: string): string => {
  const dir = item.kind === "directory" ? stripSlash(item.path) : parentOf(item.path)
  return joinPath(dir, name.trim())
}

export type DropTarget = {
  readonly directoryPath: string | null
  readonly kind: "directory" | "root"
}

export type Move = { readonly from: string; readonly to: string }

// Translate a drag-drop onto `target` into concrete from→to moves: each dragged
// path keeps its basename under the target directory (root → ""). No-ops (item
// already in the target dir) and self-descendant moves are dropped — both would
// be rejected by the daemon anyway.
export const dropMoves = (draggedPaths: readonly string[], target: DropTarget): readonly Move[] => {
  const dir = target.kind === "root" ? "" : stripSlash(target.directoryPath ?? "")
  const moves: Move[] = []
  for (const raw of draggedPaths) {
    const from = stripSlash(raw)
    const to = joinPath(dir, basenameOf(from))
    if (to === from || to.startsWith(`${from}/`)) continue
    moves.push({ from, to })
  }
  return moves
}
