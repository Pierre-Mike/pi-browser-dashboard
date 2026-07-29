// Runtime decoders for the file-tree/file-content endpoints in
// useProjectFiles.ts — no `@pid/shared` contract exists for these shapes, so
// they are validated locally instead of trusted with an `as`.
import type { GitStatusEntry } from "@pierre/trees"
import { isBoolean, isNumber, isRecord, isString, parseArray } from "../../lib/guards"
import type { FileContent } from "../../lib/types"

export type ProjectTree = {
  readonly paths: readonly string[]
  readonly truncated: boolean
  // Present when requested with `?gitStatus=1`; drives @pierre/trees row badges.
  readonly gitStatus?: readonly GitStatusEntry[]
}

const GIT_STATUSES: readonly GitStatusEntry["status"][] = [
  "added",
  "deleted",
  "ignored",
  "modified",
  "renamed",
  "untracked",
]

const isGitStatus = (v: unknown): v is GitStatusEntry["status"] =>
  isString(v) && (GIT_STATUSES as readonly string[]).includes(v)

const parseGitStatusEntry = (v: unknown): GitStatusEntry | null => {
  if (!isRecord(v)) return null
  const { path, status } = v
  return isString(path) && isGitStatus(status) ? { path, status } : null
}

export const parseProjectTree = (v: unknown): ProjectTree | null => {
  if (!isRecord(v)) return null
  const { paths, truncated, gitStatus } = v
  if (!Array.isArray(paths) || !paths.every(isString) || !isBoolean(truncated)) return null
  if (gitStatus === undefined) return { paths, truncated }
  const entries = parseArray(gitStatus, parseGitStatusEntry)
  return entries ? { paths, truncated, gitStatus: entries } : null
}

export const parseFileContent = (v: unknown): FileContent | null => {
  if (!isRecord(v)) return null
  const { path, size, isBinary, truncated, content } = v
  if (
    !isString(path) ||
    !isNumber(size) ||
    !isBoolean(isBinary) ||
    !isBoolean(truncated) ||
    !isString(content)
  )
    return null
  return { path, size, isBinary, truncated, content }
}

// The `fs/*` mutation endpoints answer `{ error: "..." }` on failure; anything
// else (a non-JSON body, or JSON with no string `error`) falls back to a
// status-based message at the call site.
export const parseErrorField = (v: unknown): string | undefined => {
  if (!isRecord(v)) return undefined
  return isString(v.error) ? v.error : undefined
}
