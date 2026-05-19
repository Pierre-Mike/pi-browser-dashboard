// Pure helpers for the projects feature. No I/O.

import { isAbsolute, normalize, relative, resolve, sep } from "node:path"

export type FileEntry = {
  readonly name: string
  readonly type: "dir" | "file" | "symlink" | "other"
  readonly size: number
}

export type ResolveOk = { readonly ok: true; readonly absPath: string; readonly relPath: string }
export type ResolveErr = { readonly ok: false; readonly reason: "escape" | "absolute" | "invalid" }
export type ResolveResult = ResolveOk | ResolveErr

// Resolve a user-supplied path against a project root and refuse anything that
// escapes the root (via "..", absolute paths, or symlink-looking tricks at the
// string layer). Symlink resolution at the filesystem layer is the repo's job.
export const resolveProjectPath = (root: string, input: string | undefined): ResolveResult => {
  const rel = (input ?? "").trim()
  if (rel === "" || rel === "." || rel === "/") {
    return { ok: true, absPath: root, relPath: "" }
  }
  if (isAbsolute(rel)) return { ok: false, reason: "absolute" }
  if (rel.includes("\0")) return { ok: false, reason: "invalid" }
  const normalized = normalize(rel)
  if (normalized.startsWith("..") || normalized.split(sep).includes("..")) {
    return { ok: false, reason: "escape" }
  }
  const absPath = resolve(root, normalized)
  const back = relative(root, absPath)
  if (back.startsWith("..") || isAbsolute(back)) {
    return { ok: false, reason: "escape" }
  }
  return { ok: true, absPath, relPath: back }
}

// Heuristic binary detection: scan the first N bytes for a NUL. Matches the
// approach used by git and ripgrep — cheap, no false negatives on real binaries,
// and short-circuits as soon as one is found.
export const looksBinary = (bytes: Uint8Array): boolean => {
  const limit = Math.min(bytes.byteLength, 8000)
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

// Stable sort: directories first, then files, both alphabetical (locale-naive).
export const sortEntries = (entries: readonly FileEntry[]): readonly FileEntry[] => {
  const rank = (t: FileEntry["type"]): number => (t === "dir" ? 0 : 1)
  return [...entries].sort((a, b) => {
    const r = rank(a.type) - rank(b.type)
    if (r !== 0) return r
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

export type GithubRemote = {
  readonly owner: string
  readonly repo: string
  readonly url: string
}

// Parses an INI-shaped .git/config and returns the GitHub `origin` remote, if
// any. Supports both SSH (`git@github.com:owner/repo.git`) and HTTPS
// (`https://github.com/owner/repo(.git)?`) origin URLs. Returns null when the
// file lacks an `[remote "origin"]` section, when its `url` is not on
// github.com, or when the URL cannot be parsed into owner/repo.
export const parseGithubOrigin = (configText: string): GithubRemote | null => {
  let inOrigin = false
  let originUrl: string | null = null
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line)
      continue
    }
    if (!inOrigin) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (key === "url") {
      originUrl = value
      break
    }
  }
  if (!originUrl) return null
  return parseGithubUrl(originUrl)
}

const stripGitSuffix = (s: string): string => (s.endsWith(".git") ? s.slice(0, -4) : s)

// Parses a `.git/HEAD` payload. Returns the branch name when HEAD points at a
// `refs/heads/<name>` ref, or null for detached HEAD, non-branch refs, and
// malformed/empty input. The branch name is preserved verbatim (slashes intact)
// so feature branches like `feat/login` render correctly.
export const parseGitHead = (text: string): string | null => {
  const line = text.trim()
  if (line === "") return null
  const refMatch = /^ref:\s*refs\/heads\/(.+?)\s*$/.exec(line)
  if (!refMatch?.[1]) return null
  return refMatch[1]
}

// Parses the stdout of `git log -1 --format=%ct HEAD` (unix seconds) into
// milliseconds. Returns null for empty, malformed, or non-positive input — the
// caller will fall back to directory mtime when the repo has no commits yet or
// git is unavailable.
export const parseGitCommitTimestamp = (stdout: string): number | null => {
  const trimmed = stdout.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return null
  const seconds = Number(trimmed)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds * 1000
}

type ProjectSortKey = {
  readonly lastModified: number
  readonly lastCommitMs?: number
}

// Newest-first comparator. Prefers `lastCommitMs` (HEAD commit time) when
// available, falling back to filesystem mtime so non-git projects still sort
// sensibly alongside git ones.
export const compareProjectsByCommit = (a: ProjectSortKey, b: ProjectSortKey): number => {
  const ka = a.lastCommitMs ?? a.lastModified
  const kb = b.lastCommitMs ?? b.lastModified
  return kb - ka
}

export const parseGithubUrl = (url: string): GithubRemote | null => {
  // SSH: git@github.com:owner/repo(.git)?
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  if (ssh?.[1] && ssh[2]) {
    const owner = ssh[1]
    const repo = stripGitSuffix(ssh[2])
    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
    }
  }
  // HTTPS/SSH-URL: (https?|ssh|git)://[user@]github.com/owner/repo(.git)?
  const httpsLike =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/.exec(
      url,
    )
  if (httpsLike?.[1] && httpsLike[2]) {
    const owner = httpsLike[1]
    const repo = stripGitSuffix(httpsLike[2])
    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
    }
  }
  return null
}
