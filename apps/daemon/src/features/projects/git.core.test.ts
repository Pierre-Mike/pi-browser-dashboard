import { describe, expect, it } from "bun:test"
import { GIT_LOG_FIELD_SEP, GIT_LOG_FORMAT, parseGitLog, parseGitStatusPorcelain } from "./git.core"

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
