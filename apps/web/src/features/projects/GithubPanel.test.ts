import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "GithubPanel.tsx"), "utf8")
const hookSrc = readFileSync(join(import.meta.dir, "useProjectGithub.ts"), "utf8")

describe("GithubPanel inline PR-diff viewer", () => {
  it("renders the PR diff with @pierre/diffs PatchDiff", () => {
    expect(src).toMatch(/from\s+["']@pierre\/diffs\/react["']/)
    expect(src).toContain("PatchDiff")
  })

  it("reuses the shared PATCH_DIFF_OPTIONS instead of bespoke options", () => {
    expect(src).toMatch(/from\s+["']\.\.\/diffs\/diffsOptions["']/)
    expect(src).toContain("PATCH_DIFF_OPTIONS")
  })

  it("splits the unified diff per file via the shared parser", () => {
    expect(src).toMatch(/from\s+["']\.\.\/sessions\/diffParse["']/)
    expect(src).toContain("parseUnifiedDiff")
  })

  it("makes each PR row expandable to reveal its diff", () => {
    expect(src).toContain('data-testid="gh-pr-toggle"')
    expect(src).toContain('data-testid="gh-pr-diff"')
    expect(src).toContain("aria-expanded")
  })

  it("keeps the external GitHub link alongside the toggle", () => {
    expect(src).toContain('data-testid="gh-pr-link"')
    expect(src).toMatch(/target="_blank"/)
  })
})

describe("useProjectPrDiff", () => {
  it("targets the per-PR diff endpoint", () => {
    expect(hookSrc).toContain("useProjectPrDiff")
    expect(hookSrc).toMatch(/github\.pr\[":prNumber"\]\.diff\.\$get/)
  })

  it("is lazy — gated by an enabled flag and keyed per PR", () => {
    expect(hookSrc).toMatch(/prNumber[^}]*enabled/)
    expect(hookSrc).toMatch(/queryKey:\s*\[[^\]]*"pr-diff"[^\]]*prNumber/)
  })
})
