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

// Resolve a project id (a directory name under projectsRoot) to its absolute
// path, rejecting anything that isn't a plain single segment — leading dots,
// path separators, and NUL bytes — so a crafted id can't escape projectsRoot.
export const projectPathFromId = (projectsRoot: string, id: string): string | null => {
  if (!id || id.startsWith(".") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    return null
  }
  return resolve(projectsRoot, id)
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

// Extension → MIME type. The browser uses Content-Type to decide whether to
// render inline (image/audio/video/pdf), iframe (html), or treat as opaque
// download. Covers the formats the file viewer needs; everything else falls
// back to application/octet-stream.
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  jsonl: "application/json; charset=utf-8",
  ndjson: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  yaml: "application/yaml; charset=utf-8",
  yml: "application/yaml; charset=utf-8",
  toml: "application/toml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  ts: "text/typescript; charset=utf-8",
  tsx: "text/typescript; charset=utf-8",
  jsx: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  pdf: "application/pdf",
}

export const mimeFromPath = (relPath: string): string => {
  const name = relPath.toLowerCase()
  const dot = name.lastIndexOf(".")
  if (dot === -1 || dot === name.length - 1) return "application/octet-stream"
  const ext = name.slice(dot + 1)
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
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
