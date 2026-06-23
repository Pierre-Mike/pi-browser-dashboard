// Shared HTTP helpers for file-browser route handlers. Reused by both
// projects.routes and sessions.routes to avoid duplication.

import { type TreeGitStatusEntry, toTreeGitStatus } from "./git.core"
import { gitStatus } from "./git.repo"
import type { FileError } from "./projects.repo"

export const errorToStatus = (e: FileError): 400 | 403 | 404 | 413 => {
  switch (e) {
    case "forbidden":
      return 403
    case "not_a_directory":
    case "not_a_file":
      return 400
    case "too_large":
      return 413
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
