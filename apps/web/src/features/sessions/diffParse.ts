// Pure helpers for splitting `git diff` output into per-file blocks and
// classifying each line. Used by FilesTab — no React or fetch here.

export type DiffLineKind = "header" | "hunk" | "context" | "addition" | "deletion" | "meta"

export type DiffLine = { readonly kind: DiffLineKind; readonly text: string }

export type FileDiff = {
  readonly oldPath: string | null
  readonly newPath: string | null
  readonly path: string
  readonly lines: readonly DiffLine[]
}

const DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/
const RENAME_FROM_RE = /^rename from (.+)$/
const RENAME_TO_RE = /^rename to (.+)$/

const classify = (line: string): DiffLineKind => {
  if (line.startsWith("@@")) return "hunk"
  if (line.startsWith("+++") || line.startsWith("---")) return "header"
  if (line.startsWith("+")) return "addition"
  if (line.startsWith("-")) return "deletion"
  return "context"
}

// Splits a unified diff into one entry per file. Robust to:
//   - rename headers (rename from / rename to)
//   - binary diffs ("Binary files … differ")
//   - missing trailing newline
//   - empty input
export const parseUnifiedDiff = (raw: string): readonly FileDiff[] => {
  if (!raw) return []
  const files: FileDiff[] = []
  let current: {
    oldPath: string | null
    newPath: string | null
    lines: DiffLine[]
  } | null = null

  const flush = (): void => {
    if (!current) return
    const path = current.newPath ?? current.oldPath ?? "(unknown)"
    files.push({
      oldPath: current.oldPath,
      newPath: current.newPath,
      path,
      lines: current.lines,
    })
    current = null
  }

  const split = raw.split("\n")
  // Drop the trailing empty token left by a final "\n" so callers don't see a
  // spurious "context" line at the end of every file.
  if (split.length > 0 && split[split.length - 1] === "") split.pop()
  for (const line of split) {
    const headerMatch = DIFF_HEADER_RE.exec(line)
    if (headerMatch) {
      flush()
      current = {
        oldPath: headerMatch[1] ?? null,
        newPath: headerMatch[2] ?? null,
        lines: [{ kind: "header", text: line }],
      }
      continue
    }
    if (!current) {
      // Lines before any "diff --git" header (rare) are ignored.
      continue
    }
    const renameFrom = RENAME_FROM_RE.exec(line)
    if (renameFrom?.[1]) current.oldPath = renameFrom[1]
    const renameTo = RENAME_TO_RE.exec(line)
    if (renameTo?.[1]) current.newPath = renameTo[1]
    const isMeta =
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename ") ||
      line.startsWith("Binary files")
    current.lines.push({ kind: isMeta ? "meta" : classify(line), text: line })
  }
  flush()
  return files
}

// Convenience aggregate used by callers that want a tiny banner.
export const summarizeDiff = (
  files: readonly FileDiff[],
): { readonly additions: number; readonly deletions: number } => {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    for (const l of f.lines) {
      if (l.kind === "addition" && !l.text.startsWith("+++")) additions += 1
      else if (l.kind === "deletion" && !l.text.startsWith("---")) deletions += 1
    }
  }
  return { additions, deletions }
}
