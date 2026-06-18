import { describe, expect, it } from "bun:test"
import {
  GIT_LOG_FIELD_SEP,
  GIT_LOG_FORMAT,
  type GitStatus,
  parseGitLog,
  parseGitPull,
  parseGitStatusPorcelain,
  toTreeGitStatus,
} from "./git.core"

describe("parseGitStatusPorcelain", () => {
  it("reads the branch name and ahead/behind from the header", () => {
    const out = "## main...origin/main [ahead 1, behind 2]\n"
    const s = parseGitStatusPorcelain(out)
    expect(s.branch).toBe("main")
    expect(s.ahead).toBe(1)
    expect(s.behind).toBe(2)
    expect(s.entries).toEqual([])
  })

  it("parses staged, unstaged, and untracked entries", () => {
    const out = ["## main", "M  staged.ts", " M unstaged.ts", "?? new.ts"].join("\n")
    const s = parseGitStatusPorcelain(out)
    expect(s.branch).toBe("main")
    expect(s.entries).toEqual([
      { index: "M", worktree: " ", path: "staged.ts" },
      { index: " ", worktree: "M", path: "unstaged.ts" },
      { index: "?", worktree: "?", path: "new.ts" },
    ])
  })

  it("reports a null branch for a detached HEAD", () => {
    const s = parseGitStatusPorcelain("## HEAD (no branch)\n")
    expect(s.branch).toBeNull()
  })

  it("reports a null branch before the first commit", () => {
    const s = parseGitStatusPorcelain("## No commits yet on main\n")
    expect(s.branch).toBeNull()
  })

  it("returns a clean status with no entries", () => {
    const s = parseGitStatusPorcelain("## main...origin/main\n")
    expect(s.entries).toEqual([])
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })
})

describe("toTreeGitStatus", () => {
  const status = (entries: GitStatus["entries"]): GitStatus => ({
    branch: "main",
    ahead: 0,
    behind: 0,
    entries,
  })

  it("maps each porcelain code to the @pierre/trees status shape", () => {
    const s = status([
      { index: "M", worktree: " ", path: "staged.ts" },
      { index: " ", worktree: "M", path: "unstaged.ts" },
      { index: "A", worktree: " ", path: "added.ts" },
      { index: " ", worktree: "D", path: "gone.ts" },
      { index: "?", worktree: "?", path: "new.ts" },
      { index: "!", worktree: "!", path: "ignored.ts" },
    ])
    expect(toTreeGitStatus(s)).toEqual([
      { path: "staged.ts", status: "modified" },
      { path: "unstaged.ts", status: "modified" },
      { path: "added.ts", status: "added" },
      { path: "gone.ts", status: "deleted" },
      { path: "new.ts", status: "untracked" },
      { path: "ignored.ts", status: "ignored" },
    ])
  })

  it("prefers the staged (index) code over the worktree code", () => {
    // A file added to the index but since modified in the worktree (`AM`)
    // is surfaced as added — the staged intent wins.
    const s = status([{ index: "A", worktree: "M", path: "both.ts" }])
    expect(toTreeGitStatus(s)).toEqual([{ path: "both.ts", status: "added" }])
  })

  it("reports a rename against its destination path", () => {
    // Porcelain renames carry `old -> new`; the tree holds the new path.
    const s = status([{ index: "R", worktree: " ", path: "old.ts -> new.ts" }])
    expect(toTreeGitStatus(s)).toEqual([{ path: "new.ts", status: "renamed" }])
  })

  it("drops entries whose codes carry no displayable status", () => {
    const s = status([{ index: " ", worktree: " ", path: "noop.ts" }])
    expect(toTreeGitStatus(s)).toEqual([])
  })
})

describe("parseGitLog", () => {
  it("parses NUL-delimited commit records", () => {
    const rows = [
      ["abc123", "Ada", "2026-01-01T00:00:00Z", "first commit"],
      ["def456", "Babbage", "2026-01-02T00:00:00Z", "second commit"],
    ]
    const out = `${rows.map((r) => r.join(GIT_LOG_FIELD_SEP)).join("\n")}\n`
    expect(parseGitLog(out)).toEqual([
      { hash: "abc123", author: "Ada", date: "2026-01-01T00:00:00Z", subject: "first commit" },
      {
        hash: "def456",
        author: "Babbage",
        date: "2026-01-02T00:00:00Z",
        subject: "second commit",
      },
    ])
  })

  it("returns an empty list for empty output", () => {
    expect(parseGitLog("")).toEqual([])
  })

  it("wires GIT_LOG_FORMAT to the field separator", () => {
    expect(GIT_LOG_FORMAT.split(GIT_LOG_FIELD_SEP)).toEqual(["%H", "%an", "%aI", "%s"])
  })
})

describe("parseGitPull", () => {
  it("flags an up-to-date pull and trims the output", () => {
    const s = parseGitPull("Already up to date.\n")
    expect(s.alreadyUpToDate).toBe(true)
    expect(s.output).toBe("Already up to date.")
  })

  it("treats a fast-forward pull as a real update", () => {
    const out = "Updating abc123..def456\nFast-forward\n a.txt | 1 +\n"
    const s = parseGitPull(out)
    expect(s.alreadyUpToDate).toBe(false)
    expect(s.output).toContain("Fast-forward")
  })

  it("matches the up-to-date message case-insensitively", () => {
    expect(parseGitPull("already up to date").alreadyUpToDate).toBe(true)
  })
})
