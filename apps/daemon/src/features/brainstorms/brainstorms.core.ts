import path from "node:path"
import { NAME_RE } from "../../platform/extensions/manifest"

// A brainstorm is one named drawing document stored inside the project at
// .pid/brainstorms/. Two document kinds share the directory: the original
// React-Flow canvas (<id>.canvas.json) and the Excalidraw board
// (<id>.excalidraw, Excalidraw's native format so agents and excalidraw.com
// can open the file as-is). Keeping files project-local (rather than in
// ~/.claude/jobs like the per-session canvas) means they are git-versionable
// and any AI session spawned with the project as cwd can Read/Write the
// drawing with plain file tools.

export type BrainstormKind = "canvas" | "excalidraw"

const KIND_SUFFIX: Record<BrainstormKind, string> = {
  canvas: ".canvas.json",
  excalidraw: ".excalidraw",
}

export type Brainstorm = {
  readonly id: string
  readonly label: string
  readonly kind: BrainstormKind
  // Absolute path of the document — surfaced to the web UI so the
  // companion prompts can point an agent directly at the file.
  readonly file: string
  readonly updatedAt: string
}

export type BrainstormDoc = { readonly id: string; readonly kind: BrainstormKind }

// Same charset the pid-app creator enforces, so brainstorm ids stay safe as
// path segments and as `?tab=brainstorm:<id>` URL params.
export const isCreatableBrainstormName = (name: string): boolean => NAME_RE.test(name)

export const brainstormsDirFor = (projectPath: string): string =>
  path.join(projectPath, ".pid", "brainstorms")

export const brainstormFileNameFor = (id: string, kind: BrainstormKind): string =>
  `${id}${KIND_SUFFIX[kind]}`

// Inverse of brainstormFileNameFor for discovery: null for anything that is
// not a well-formed <id><suffix> basename. Untrusted directory contents must
// never crash discovery, so bad names are skipped, not thrown.
export const brainstormDocFromFileName = (filename: string): BrainstormDoc | null => {
  for (const kind of ["canvas", "excalidraw"] as const) {
    const suffix = KIND_SUFFIX[kind]
    if (!filename.endsWith(suffix)) continue
    const id = filename.slice(0, -suffix.length)
    return NAME_RE.test(id) ? { id, kind } : null
  }
  return null
}

// Deterministic order: alphabetical by id. When both kinds claim the same id
// the canvas document wins — ids double as tab keys, so one id maps to one
// board.
export const discoverBrainstormDocs = (filenames: readonly string[]): readonly BrainstormDoc[] => {
  const byId = new Map<string, BrainstormDoc>()
  for (const doc of filenames.map(brainstormDocFromFileName)) {
    if (doc === null) continue
    const existing = byId.get(doc.id)
    if (existing === undefined || (existing.kind === "excalidraw" && doc.kind === "canvas")) {
      byId.set(doc.id, doc)
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
