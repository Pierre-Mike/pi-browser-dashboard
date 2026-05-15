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
