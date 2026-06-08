// Imperative shell over `git`: spawns the CLI and hands raw output to the pure
// parsers in git.core.ts. Read-only commands only (status, log) — these back
// the extension RPC's repo-context contract.

import {
  GIT_LOG_FORMAT,
  type GitLogEntry,
  type GitStatus,
  parseGitLog,
  parseGitStatusPorcelain,
} from "./git.core"

const GIT_TIMEOUT_MS = 5_000
const DEFAULT_LOG_LIMIT = 20
const MAX_LOG_LIMIT = 200

export type GitError = "not_a_repo" | "git_failed" | "timeout"
export type GitResult<A> = { ok: true; value: A } | { ok: false; error: GitError }

// Run a git subcommand against repoPath, returning stdout on success. Times out
// so a wedged repo can't stall the request.
const runGit = async (repoPath: string, args: readonly string[]): Promise<GitResult<string>> => {
  try {
    const proc = Bun.spawn({
      cmd: ["git", "-C", repoPath, ...args],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        proc.kill()
      } catch {
        // already exited
      }
    }, GIT_TIMEOUT_MS)
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    clearTimeout(timer)
    if (timedOut) return { ok: false, error: "timeout" }
    if (exitCode !== 0) {
      // git uses 128 for "not a git repository" among other fatals.
      const notRepo = /not a git repository/i.test(stderr)
      return { ok: false, error: notRepo ? "not_a_repo" : "git_failed" }
    }
    return { ok: true, value: stdout }
  } catch {
    return { ok: false, error: "git_failed" }
  }
}

export const gitStatus = async (repoPath: string): Promise<GitResult<GitStatus>> => {
  const res = await runGit(repoPath, ["status", "--porcelain=v1", "-b"])
  if (!res.ok) return res
  return { ok: true, value: parseGitStatusPorcelain(res.value) }
}

export const gitLog = async (
  repoPath: string,
  limit?: number,
): Promise<GitResult<readonly GitLogEntry[]>> => {
  const n = clampLimit(limit)
  const res = await runGit(repoPath, ["log", `-n`, String(n), `--format=${GIT_LOG_FORMAT}`])
  if (!res.ok) return res
  return { ok: true, value: parseGitLog(res.value) }
}

// Coerce an untrusted limit into [1, MAX_LOG_LIMIT], defaulting when absent.
export const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LOG_LIMIT
  return Math.max(1, Math.min(MAX_LOG_LIMIT, Math.floor(limit)))
}
