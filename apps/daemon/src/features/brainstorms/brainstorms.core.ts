import { NAME_RE } from "../../platform/extensions/manifest"

// A brainstorm is any drawing document that lives in the tree you are working
// in — the session's worktree. Discovery is by *suffix over the whole tree*, not
// by directory: every `*.canvas`, `*.canvas.json` and `*.excalidraw` file is a
// board, wherever it sits. A board's identity is therefore its repo-relative
// path, so moving a file is a rename in git and nothing else.
//
// New boards are created in `brainstorms/` because a default has to be
// somewhere; nothing depends on them staying there. The older
// `.pid/brainstorms/` documents keep working for exactly this reason — they are
// found by suffix like anything else.

export type BrainstormKind = "canvas" | "canvasJson" | "excalidraw"

// The two editors. `.canvas` and `.canvas.json` are two encodings of the same
// board, so they share one editor and one live-sync wire format.
export type BrainstormEditor = "canvas" | "excalidraw"

// The formats a new board can be created in. `canvasJson` is read/write but
// never created: `.canvas` is the open JSON Canvas spec that Obsidian and other
// tools already read.
export type CreatableBrainstormKind = "canvas" | "excalidraw"

export type BrainstormDoc = {
  // Repo-relative, forward-slashed — the board's identity on every surface
  // (list entry, `?path=` param, `?tab=brainstorm:<path>` deep link).
  readonly path: string
  readonly label: string
  readonly kind: BrainstormKind
}

// Where a newly created board lands. The user is free to move it afterwards.
export const BRAINSTORM_DIR = "brainstorms"

// Longest suffix first: `x.canvas.json` must not be read as a `.canvas` board.
const KIND_SUFFIXES: readonly (readonly [BrainstormKind, string])[] = [
  ["canvasJson", ".canvas.json"],
  ["canvas", ".canvas"],
  ["excalidraw", ".excalidraw"],
]

const SUFFIX_BY_KIND: Record<BrainstormKind, string> = {
  canvas: ".canvas",
  canvasJson: ".canvas.json",
  excalidraw: ".excalidraw",
}

const EDITOR_BY_KIND: Record<BrainstormKind, BrainstormEditor> = {
  canvas: "canvas",
  canvasJson: "canvas",
  excalidraw: "excalidraw",
}

export const brainstormEditorFor = (kind: BrainstormKind): BrainstormEditor => EDITOR_BY_KIND[kind]

const stemOf = (input: { readonly path: string; readonly suffix: string }): string =>
  input.path.slice(0, -input.suffix.length)

// A board needs a name: `.canvas` on its own is a dotfile, not a document, and
// an empty stem would produce an unaddressable board.
const hasStem = (input: { readonly path: string; readonly suffix: string }): boolean => {
  const stem = stemOf(input)
  return stem.length > 0 && !stem.endsWith("/")
}

/** The board format a path denotes, or null when the path is not a board. */
export const brainstormKindFromPath = (path: string): BrainstormKind | null => {
  for (const [kind, suffix] of KIND_SUFFIXES) {
    if (path.endsWith(suffix) && hasStem({ path, suffix })) return kind
  }
  return null
}

/**
 * How a board reads in the rail: its path without the format suffix, and
 * without the default directory it was created in. A board that has been moved
 * elsewhere keeps its path, so two boards named `plan` never read alike.
 */
export const brainstormLabelFor = (path: string): string => {
  const kind = brainstormKindFromPath(path)
  const stem = kind === null ? path : stemOf({ path, suffix: SUFFIX_BY_KIND[kind] })
  const prefix = `${BRAINSTORM_DIR}/`
  return stem.startsWith(prefix) ? stem.slice(prefix.length) : stem
}

export const brainstormDocFromPath = (path: string): BrainstormDoc | null => {
  const kind = brainstormKindFromPath(path)
  return kind === null ? null : { path, label: brainstormLabelFor(path), kind }
}

/**
 * Every board in a tree listing, ordered by path so the rail is stable between
 * listings. Untrusted directory contents must never break discovery, so a path
 * that is not a board is skipped rather than rejected.
 */
export const discoverBrainstormDocs = (paths: readonly string[]): readonly BrainstormDoc[] => {
  const byPath = new Map<string, BrainstormDoc>()
  for (const path of paths) {
    const doc = brainstormDocFromPath(path)
    if (doc !== null) byPath.set(doc.path, doc)
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

// Same charset the pid-app creator enforces. It doubles as the traversal guard
// on the create path: a name can never contain "/", "\" or "..".
export const isCreatableBrainstormName = (name: string): boolean => NAME_RE.test(name)

export const newBrainstormPath = (input: {
  readonly name: string
  readonly kind: CreatableBrainstormKind
}): string => `${BRAINSTORM_DIR}/${input.name}${SUFFIX_BY_KIND[input.kind]}`

/**
 * Every path a proposed name could already be occupied by. A name is one
 * namespace across formats: `auth.canvas` and `auth.excalidraw` would both read
 * as "auth" in the rail, so the second create is refused rather than shipping
 * two indistinguishable boards.
 */
export const brainstormPathsForName = (name: string): readonly string[] =>
  KIND_SUFFIXES.map(([, suffix]) => `${BRAINSTORM_DIR}/${name}${suffix}`).sort()
