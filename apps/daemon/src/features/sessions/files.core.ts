// Pure parsers for the per-session "files changed" view.
//
// The daemon runs `git diff --name-status -z` and `git ls-files --others
// --exclude-standard -z` inside a session's worktree path; this module decodes
// the NUL-separated output into a typed change list. No I/O here.

export type FileChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed"
  | "untracked"
  | "unknown"

export type FileChange = {
  readonly path: string
  readonly status: FileChangeStatus
  readonly oldPath?: string
}

const STATUS_MAP: Record<string, FileChangeStatus> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type_changed",
}

const classifyCode = (code: string): FileChangeStatus => {
  const first = code.charAt(0)
  return STATUS_MAP[first] ?? "unknown"
}

// `git diff --name-status -z` emits records as NUL-separated tokens:
//   <code>\0<path>\0                 for M / A / D / T
//   <code>\0<old>\0<new>\0           for R<score> / C<score>
// Trailing NUL after the last record is optional.
export const parseNameStatus = (raw: string): readonly FileChange[] => {
  if (!raw) return []
  const tokens = raw.split("\0")
  const changes: FileChange[] = []
  let i = 0
  while (i < tokens.length) {
    const code = tokens[i]
    if (code === undefined || code === "") {
      i += 1
      continue
    }
    const status = classifyCode(code)
    const isRename = code.startsWith("R") || code.startsWith("C")
    if (isRename) {
      const oldPath = tokens[i + 1]
      const newPath = tokens[i + 2]
      if (oldPath && newPath) {
        changes.push({ path: newPath, status, oldPath })
      }
      i += 3
    } else {
      const path = tokens[i + 1]
      if (path) {
        changes.push({ path, status })
      }
      i += 2
    }
  }
  return changes
}

// `git ls-files --others --exclude-standard -z` emits NUL-separated paths.
export const parseUntracked = (raw: string): readonly FileChange[] => {
  if (!raw) return []
  const out: FileChange[] = []
  for (const token of raw.split("\0")) {
    if (token) out.push({ path: token, status: "untracked" })
  }
  return out
}

// Cap diff payloads so a noisy session can't push hundreds of KB through the
// websocket-less polling endpoint. Reported as `truncated: true` on the wire.
export const MAX_DIFF_BYTES = 200_000

export type TruncatedDiff = { readonly diff: string; readonly truncated: boolean }

export const truncateDiff = (raw: string, max: number = MAX_DIFF_BYTES): TruncatedDiff => {
  if (raw.length <= max) return { diff: raw, truncated: false }
  return { diff: raw.slice(0, max), truncated: true }
}

// Merge name-status records with untracked entries, dedup by path, and sort
// alphabetically so the client can render a stable list.
export const mergeChanges = (
  tracked: readonly FileChange[],
  untracked: readonly FileChange[],
): readonly FileChange[] => {
  const byPath = new Map<string, FileChange>()
  for (const c of tracked) byPath.set(c.path, c)
  for (const c of untracked) {
    if (!byPath.has(c.path)) byPath.set(c.path, c)
  }
  const list = Array.from(byPath.values())
  list.sort((a, b) => a.path.localeCompare(b.path))
  return list
}
