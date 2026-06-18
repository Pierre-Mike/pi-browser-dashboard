// Pure parsers for git porcelain output. No side effects — the spawning lives
// in git.repo.ts so these stay trivially testable.

export type GitStatusEntry = {
  // Porcelain v1 two-letter code: index (staged) status + worktree status.
  readonly index: string
  readonly worktree: string
  readonly path: string
}

export type GitStatus = {
  readonly branch: string | null
  readonly ahead: number
  readonly behind: number
  readonly entries: readonly GitStatusEntry[]
}

// The git-status shape @pierre/trees consumes: one status per path, used to
// render a badge on the matching tree row.
export type TreeGitStatus = "added" | "deleted" | "ignored" | "modified" | "renamed" | "untracked"
export type TreeGitStatusEntry = {
  readonly path: string
  readonly status: TreeGitStatus
}

// Porcelain v1 status char → tree badge. Codes absent here (space, plus copy/
// type-change/unmerged variants we fold into "modified") fall through the map.
const TREE_STATUS_BY_CODE: Record<string, TreeGitStatus> = {
  "?": "untracked",
  "!": "ignored",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  M: "modified",
  T: "modified",
  U: "modified",
}

// Renamed entries carry `old -> new`; the tree row is keyed by the new path.
const renameTarget = (path: string): string => {
  const arrow = path.indexOf(" -> ")
  return arrow === -1 ? path : path.slice(arrow + 4)
}

// Project a parsed git status onto @pierre/trees' GitStatusEntry[]. The staged
// (index) code wins over the worktree code; entries with no displayable code
// are dropped.
export const toTreeGitStatus = (status: GitStatus): readonly TreeGitStatusEntry[] =>
  status.entries.flatMap((e) => {
    const badge = TREE_STATUS_BY_CODE[e.index] ?? TREE_STATUS_BY_CODE[e.worktree]
    return badge ? [{ path: renameTarget(e.path), status: badge }] : []
  })

export type GitPullResult = {
  // git prints "Already up to date." when there was nothing to fetch/merge.
  readonly alreadyUpToDate: boolean
  readonly output: string
}

// Parse `git pull --ff-only` stdout. We only distinguish the no-op case from a
// real update; the trimmed output is surfaced to the UI verbatim.
export const parseGitPull = (out: string): GitPullResult => {
  const output = out.trim()
  return { alreadyUpToDate: /already up to date\.?/i.test(output), output }
}

export type GitLogEntry = {
  readonly hash: string
  readonly author: string
  readonly date: string
  readonly subject: string
}

// Field separator for our `git log --format=` string. A NUL byte would be
// ideal but Bun.spawn rejects NUL in argv, so use US (unit separator, 0x1f) —
// a control char that won't appear in author names, dates, or subjects.
export const GIT_LOG_FIELD_SEP = "\x1f"
// `git log --format=…` per-commit format wired to GIT_LOG_FIELD_SEP.
export const GIT_LOG_FORMAT = ["%H", "%an", "%aI", "%s"].join(GIT_LOG_FIELD_SEP)

const parseAheadBehind = (header: string): { ahead: number; behind: number } => {
  const ahead = /\bahead (\d+)/.exec(header)
  const behind = /\bbehind (\d+)/.exec(header)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
  }
}

// Parse `git status --porcelain=v1 -b` output. The first line is the branch
// header (`## main...origin/main [ahead 1]` or `## HEAD (no branch)`), the rest
// are `XY path` entries (`?? path` for untracked).
export const parseGitStatusPorcelain = (out: string): GitStatus => {
  const lines = out.split("\n").filter((l) => l.length > 0)
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const entries: GitStatusEntry[] = []

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const header = line.slice(3)
      if (header.startsWith("HEAD (no branch)") || header.startsWith("No commits yet")) {
        branch = null
      } else {
        // `main...origin/main [ahead 1, behind 2]` → branch is up to `...` or ` `.
        const name = header.split("...")[0]?.split(" ")[0] ?? ""
        branch = name.length > 0 ? name : null
        const ab = parseAheadBehind(header)
        ahead = ab.ahead
        behind = ab.behind
      }
      continue
    }
    if (line.length < 3) continue
    entries.push({
      index: line[0] ?? " ",
      worktree: line[1] ?? " ",
      // Skip the XY code and the single separating space.
      path: line.slice(3),
    })
  }

  return { branch, ahead, behind, entries }
}

// Parse the NUL-delimited `git log` output produced with GIT_LOG_FORMAT,
// one commit per line.
export const parseGitLog = (out: string): readonly GitLogEntry[] => {
  const entries: GitLogEntry[] = []
  for (const line of out.split("\n")) {
    if (line.length === 0) continue
    const [hash, author, date, ...rest] = line.split(GIT_LOG_FIELD_SEP)
    if (!hash) continue
    entries.push({
      hash,
      author: author ?? "",
      date: date ?? "",
      // Subjects can't contain the NUL sep, but rejoin defensively.
      subject: rest.join(GIT_LOG_FIELD_SEP),
    })
  }
  return entries
}
