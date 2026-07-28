// Imperative shell for brainstorms: the drawing documents found in one
// directory tree — a session's worktree. Discovery, creation and path
// resolution only; live document sync is NOT here (the canvas slice's
// path-keyed rooms own watching and broadcasting).
//
// Plain async functions returning a discriminated result rather than an Effect
// service, mirroring fileBrowser.io: every operation takes the already-resolved
// root, so there is no dependency to inject and no Layer to compose. The router
// that knows *which* root (the session's worktree) does that resolution.

import { mkdir, rename, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { emptyExcalidrawDoc, serializeExcalidrawDoc } from "../canvas/excalidraw.core"
import { emptyJsonCanvas, serializeJsonCanvas } from "../canvas/jsonCanvas.core"
import { resolveProjectPath, treeAt } from "../projects/fileBrowser.io"
import {
  type BrainstormDoc,
  brainstormDocFromPath,
  brainstormPathsForName,
  type CreatableBrainstormKind,
  discoverBrainstormDocs,
  isCreatableBrainstormName,
  newBrainstormPath,
} from "./brainstorms.core"

export type Brainstorm = BrainstormDoc & {
  // Absolute path on the daemon's disk — surfaced so the UI can name the file
  // the session's agent should read and write.
  readonly file: string
  readonly updatedAt: string
}

export type BrainstormRef = BrainstormDoc & { readonly file: string }

export type BrainstormReadError = "not_found" | "forbidden"
export type BrainstormWriteError = BrainstormReadError | "invalid_name" | "already_exists"

export type BrainstormResult<A, E> = { ok: true; value: A } | { ok: false; error: E }

const EMPTY_BODY: Record<CreatableBrainstormKind, () => string> = {
  canvas: () => serializeJsonCanvas(emptyJsonCanvas()),
  excalidraw: () => serializeExcalidrawDoc(emptyExcalidrawDoc()),
}

const mtimeOf = async (file: string): Promise<string | null> => {
  try {
    const s = await stat(file)
    return s.isFile() ? s.mtime.toISOString() : null
  } catch {
    return null
  }
}

const withFile = async (input: {
  readonly root: string
  readonly doc: BrainstormDoc
}): Promise<Brainstorm | null> => {
  const file = join(input.root, input.doc.path)
  const updatedAt = await mtimeOf(file)
  return updatedAt === null ? null : { ...input.doc, file, updatedAt }
}

/**
 * Every board in the tree, ordered by path. A missing or unreadable root just
 * means "no boards" — a session whose worktree has been reaped must still
 * render an empty rail rather than an error.
 */
export const listBrainstormsIn = async (root: string): Promise<readonly Brainstorm[]> => {
  const tree = await treeAt(root)
  if (!tree.ok) return []
  const boards = await Promise.all(
    discoverBrainstormDocs(tree.value.paths).map((doc) => withFile({ root, doc })),
  )
  return boards.filter((b): b is Brainstorm => b !== null)
}

// tmp+rename so a concurrent reader (a document room priming its cache, or the
// session's agent reading the file) never observes a half-written document.
const writeAtomic = async (input: {
  readonly file: string
  readonly body: string
}): Promise<void> => {
  await mkdir(dirname(input.file), { recursive: true })
  const tmp = `${input.file}.${process.pid}.tmp`
  await writeFile(tmp, input.body, "utf8")
  await rename(tmp, input.file)
}

/**
 * Create an empty board at `brainstorms/<name>.<ext>`. The name is one
 * namespace across formats, so a name already taken by any format is refused
 * rather than producing two boards that read alike in the rail.
 */
export const createBrainstormIn = async (input: {
  readonly root: string
  readonly name: string
  readonly kind: CreatableBrainstormKind
}): Promise<BrainstormResult<Brainstorm, BrainstormWriteError>> => {
  if (!isCreatableBrainstormName(input.name)) return { ok: false, error: "invalid_name" }
  for (const candidate of brainstormPathsForName(input.name)) {
    if ((await mtimeOf(join(input.root, candidate))) !== null) {
      return { ok: false, error: "already_exists" }
    }
  }
  const path = newBrainstormPath({ name: input.name, kind: input.kind })
  const doc = brainstormDocFromPath(path)
  if (doc === null) return { ok: false, error: "invalid_name" }
  await writeAtomic({ file: join(input.root, path), body: EMPTY_BODY[input.kind]() })
  const created = await withFile({ root: input.root, doc })
  return created === null ? { ok: false, error: "not_found" } : { ok: true, value: created }
}

/**
 * Resolve an existing board's path to its absolute file and format. Creation is
 * explicit, so a missing file is `not_found` rather than an auto-created empty
 * board; a path that escapes the root, or names the root itself, is `forbidden`.
 */
export const resolveBrainstormIn = async (input: {
  readonly root: string
  readonly path: string
}): Promise<BrainstormResult<BrainstormRef, BrainstormReadError>> => {
  const resolved = resolveProjectPath(input.root, input.path)
  if (!resolved.ok || resolved.relPath === "") return { ok: false, error: "forbidden" }
  const doc = brainstormDocFromPath(resolved.relPath)
  if (doc === null) return { ok: false, error: "not_found" }
  if ((await mtimeOf(resolved.absPath)) === null) return { ok: false, error: "not_found" }
  return { ok: true, value: { ...doc, file: resolved.absPath } }
}
