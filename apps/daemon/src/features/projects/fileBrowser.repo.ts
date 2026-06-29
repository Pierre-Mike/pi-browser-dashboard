// Shared filesystem operations for browsing a directory tree at an arbitrary
// root path. Used by both the projects feature (keyed by project id) and the
// sessions feature (keyed by session worktreePath / cwd).
//
// All functions return a plain discriminated result — no Effect — so they can
// be called from any async context without a runtime.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  isSkippedTreeDir,
  looksBinary,
  MAX_TREE_FILES,
  mimeFromPath,
  resolveProjectPath,
} from "./projects.core"
import type { FileError } from "./projects.repo"

export type BrowserResult<A> = { ok: true; value: A } | { ok: false; error: FileError }

// Write ops add one failure mode the read paths can't hit — a create/move whose
// destination already exists. Kept local to the write surface so the read-side
// FileError union stays untouched.
export type WriteError = FileError | "exists"
export type WriteResult<A> = { ok: true; value: A } | { ok: false; error: WriteError }

export type FileTreeListing = {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

export type FileContent = {
  readonly path: string
  readonly size: number
  readonly isBinary: boolean
  readonly truncated: boolean
  readonly content: string
}

export type RawFile = {
  readonly absPath: string
  readonly relPath: string
  readonly size: number
  readonly mime: string
}

const MAX_READ_BYTES = 1_000_000 // 1 MB hard cap on text previews
const MAX_RAW_BYTES = 50_000_000 // 50 MB hard cap on raw media streams

const scanDir = async (root: string, rel: string): Promise<{ files: string[]; dirs: string[] }> => {
  const abs = rel === "" ? root : join(root, rel)
  const files: string[] = []
  const dirs: string[] = []
  let dirents: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = []
  try {
    dirents = await readdir(abs, { withFileTypes: true })
  } catch {
    return { files, dirs }
  }
  for (const d of dirents) {
    const childRel = rel === "" ? d.name : `${rel}/${d.name}`
    if (d.isDirectory() && !isSkippedTreeDir(d.name)) dirs.push(childRel)
    else if (d.isFile()) files.push(childRel)
  }
  return { files, dirs }
}

const walkTree = async (root: string): Promise<{ paths: string[]; truncated: boolean }> => {
  const paths: string[] = []
  const stack: string[] = [""]
  while (stack.length > 0) {
    const { files, dirs } = await scanDir(root, stack.pop() as string)
    for (const f of files) {
      if (paths.length >= MAX_TREE_FILES) return { paths, truncated: true }
      paths.push(f)
    }
    stack.push(...dirs)
  }
  return { paths, truncated: false }
}

export const treeAt = async (root: string): Promise<BrowserResult<FileTreeListing>> => {
  let s: Awaited<ReturnType<typeof stat>>
  try {
    s = await stat(root)
  } catch {
    return { ok: false, error: "not_found" }
  }
  if (!s.isDirectory()) return { ok: false, error: "not_a_directory" }
  try {
    const { paths, truncated } = await walkTree(root)
    paths.sort()
    return { ok: true, value: { paths, truncated } }
  } catch {
    return { ok: true, value: { paths: [], truncated: false } }
  }
}

export const readFileAt = async (
  root: string,
  rel: string,
): Promise<BrowserResult<FileContent>> => {
  const resolved = resolveProjectPath(root, rel)
  if (!resolved.ok) return { ok: false, error: "forbidden" }
  let s: Awaited<ReturnType<typeof stat>>
  try {
    s = await stat(resolved.absPath)
  } catch {
    return { ok: false, error: "not_found" }
  }
  if (!s.isFile()) return { ok: false, error: "not_a_file" }
  if (s.size > MAX_READ_BYTES) return { ok: false, error: "too_large" }
  let bytes: Uint8Array
  try {
    bytes = (await readFile(resolved.absPath)) as unknown as Uint8Array
  } catch {
    return { ok: false, error: "not_found" }
  }
  const isBinary = looksBinary(bytes)
  return {
    ok: true,
    value: {
      path: resolved.relPath,
      size: s.size,
      isBinary,
      truncated: false,
      content: isBinary ? "" : new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    },
  }
}

// ── Write operations ──────────────────────────────────────────────────────
// Mutating counterparts to the read ops above. Same traversal guard
// (resolveProjectPath rejects "..", absolute, NUL). create/move return a
// WriteResult (they can fail "exists"); the root itself ("") is never a valid
// mutation target.

const pathExists = async (abs: string): Promise<boolean> => {
  try {
    await stat(abs)
    return true
  } catch {
    return false
  }
}

// Create an empty file or a directory at `path`. Parent directories are created
// as needed. Refuses to overwrite an existing path ("exists") so a create never
// silently clobbers.
export const createAt = async (
  root: string,
  { path: rel, kind }: { path: string; kind: "file" | "directory" },
): Promise<WriteResult<{ path: string }>> => {
  const resolved = resolveProjectPath(root, rel)
  if (!resolved.ok || resolved.relPath === "") return { ok: false, error: "forbidden" }
  if (await pathExists(resolved.absPath)) return { ok: false, error: "exists" }
  try {
    if (kind === "directory") {
      await mkdir(resolved.absPath, { recursive: true })
    } else {
      await mkdir(dirname(resolved.absPath), { recursive: true })
      await writeFile(resolved.absPath, "", { flag: "wx" })
    }
  } catch {
    return { ok: false, error: "not_found" }
  }
  return { ok: true, value: { path: resolved.relPath } }
}

// Move/rename `from` → `to`. Both endpoints are traversal-guarded; the
// destination's parent is created as needed. Refuses a missing source
// ("not_found"), an occupied destination ("exists"), and moving a directory
// into its own descendant ("forbidden").
export const moveAt = async (
  root: string,
  { from: fromRel, to: toRel }: { from: string; to: string },
): Promise<WriteResult<{ from: string; to: string }>> => {
  const from = resolveProjectPath(root, fromRel)
  const to = resolveProjectPath(root, toRel)
  if (!from.ok || from.relPath === "") return { ok: false, error: "forbidden" }
  if (!to.ok || to.relPath === "") return { ok: false, error: "forbidden" }
  if (to.relPath === from.relPath || to.relPath.startsWith(`${from.relPath}/`)) {
    return { ok: false, error: "forbidden" }
  }
  if (!(await pathExists(from.absPath))) return { ok: false, error: "not_found" }
  if (await pathExists(to.absPath)) return { ok: false, error: "exists" }
  try {
    await mkdir(dirname(to.absPath), { recursive: true })
    await rename(from.absPath, to.absPath)
  } catch {
    return { ok: false, error: "not_found" }
  }
  return { ok: true, value: { from: from.relPath, to: to.relPath } }
}

// Delete the file or directory at `path`. `recursive` must be true to remove a
// non-empty directory; a non-recursive remove of a directory fails
// ("not_a_file"). Never removes the root.
export const removeAt = async (
  root: string,
  { path: rel, recursive }: { path: string; recursive: boolean },
): Promise<BrowserResult<{ path: string }>> => {
  const resolved = resolveProjectPath(root, rel)
  if (!resolved.ok || resolved.relPath === "") return { ok: false, error: "forbidden" }
  if (!(await pathExists(resolved.absPath))) return { ok: false, error: "not_found" }
  try {
    await rm(resolved.absPath, { recursive, force: false })
  } catch {
    return { ok: false, error: "not_a_file" }
  }
  return { ok: true, value: { path: resolved.relPath } }
}

export const resolveRawAt = async (root: string, rel: string): Promise<BrowserResult<RawFile>> => {
  const resolved = resolveProjectPath(root, rel)
  if (!resolved.ok) return { ok: false, error: "forbidden" }
  let s: Awaited<ReturnType<typeof stat>>
  try {
    s = await stat(resolved.absPath)
  } catch {
    return { ok: false, error: "not_found" }
  }
  if (!s.isFile()) return { ok: false, error: "not_a_file" }
  if (s.size > MAX_RAW_BYTES) return { ok: false, error: "too_large" }
  return {
    ok: true,
    value: {
      absPath: resolved.absPath,
      relPath: resolved.relPath,
      size: s.size,
      mime: mimeFromPath(resolved.relPath),
    },
  }
}
