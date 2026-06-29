// Shared HTTP helpers for file-browser route handlers. Reused by both
// projects.routes and sessions.routes to avoid duplication.

import { createAt, moveAt, removeAt, type WriteError } from "./fileBrowser.repo"
import { type TreeGitStatusEntry, toTreeGitStatus } from "./git.core"
import { gitStatus } from "./git.repo"

// Accepts WriteError (FileError ∪ "exists"); read routes pass plain FileError.
export const errorToStatus = (e: WriteError): 400 | 403 | 404 | 409 | 413 => {
  switch (e) {
    case "forbidden":
      return 403
    case "not_a_directory":
    case "not_a_file":
      return 400
    case "too_large":
      return 413
    case "exists":
      return 409
    default:
      return 404
  }
}

// Optional git-status overlay for the file tree, mapped to @pierre/trees'
// GitStatusEntry[]. Never fails the listing: a non-repo path or git error
// yields no badges.
export const treeGitStatusAt = async (path: string): Promise<readonly TreeGitStatusEntry[]> => {
  const res = await gitStatus(path)
  return res.ok ? toTreeGitStatus(res.value) : []
}

// ── Filesystem-mutation dispatch ────────────────────────────────────────────
// Shared between projects.routes and sessions.routes: each parses the request
// body, runs a guarded write op against the already-resolved root, and maps the
// result to an HTTP status. The root resolution (project id / session short)
// stays in the per-feature router; the mutation logic lives here, once.

export type FsResponse = {
  readonly status: 200 | 400 | 403 | 404 | 409 | 413
  readonly body: unknown
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "")
const obj = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {}

const fromResult = (
  res: { ok: true; value: unknown } | { ok: false; error: WriteError },
): FsResponse =>
  res.ok
    ? { status: 200, body: res.value }
    : { status: errorToStatus(res.error), body: { error: res.error } }

export const runFsCreate = async (root: string, body: unknown): Promise<FsResponse> => {
  const b = obj(body)
  const path = asString(b.path)
  if (!path) return { status: 400, body: { error: "missing_path" } }
  const kind = b.kind === "directory" ? "directory" : "file"
  return fromResult(await createAt(root, { path, kind }))
}

export const runFsMove = async (root: string, body: unknown): Promise<FsResponse> => {
  const b = obj(body)
  const from = asString(b.from)
  const to = asString(b.to)
  if (!from || !to) return { status: 400, body: { error: "missing_path" } }
  return fromResult(await moveAt(root, { from, to }))
}

export const runFsDelete = async (root: string, body: unknown): Promise<FsResponse> => {
  const b = obj(body)
  const path = asString(b.path)
  if (!path) return { status: 400, body: { error: "missing_path" } }
  return fromResult(await removeAt(root, { path, recursive: b.recursive === true }))
}
