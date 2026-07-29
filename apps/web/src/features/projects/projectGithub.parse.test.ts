import { describe, expect, it } from "bun:test"
import type { GithubProjectSummary } from "../../lib/types"
import {
  type GithubPrDiff,
  type GitPullResult,
  parseGithubPrDiff,
  parseGithubProjectSummary,
  parseGitPullResult,
} from "./projectGithub.parse"

const pr = {
  number: 5,
  title: "Fix the thing",
  url: "https://github.com/x/y/pull/5",
  author: "octocat",
  isDraft: false,
  state: "OPEN" as const,
  headRefName: "fix-thing",
  updatedAt: "2026-06-13T00:00:00Z",
}

const run = {
  id: 1,
  name: "CI",
  status: "completed" as const,
  conclusion: "success" as const,
  headBranch: "main",
  headSha: "abc123",
  url: "https://github.com/x/y/actions/runs/1",
  event: "push",
  createdAt: "2026-06-13T00:00:00Z",
}

describe("parseGithubProjectSummary", () => {
  it("accepts a summary with PRs and runs, no warning", () => {
    const summary: GithubProjectSummary = { prs: [pr], runs: [run] }
    expect(parseGithubProjectSummary(summary)).toEqual(summary)
  })

  it("accepts a summary carrying a warning", () => {
    const summary: GithubProjectSummary = { prs: [], runs: [], warning: "gh not authenticated" }
    expect(parseGithubProjectSummary(summary)).toEqual(summary)
  })

  it("accepts a null conclusion (run still in progress)", () => {
    const summary = { prs: [], runs: [{ ...run, conclusion: null }] }
    expect(parseGithubProjectSummary(summary)?.runs[0]?.conclusion).toBeNull()
  })

  it("rejects an unrecognized PR state or run status", () => {
    expect(parseGithubProjectSummary({ prs: [{ ...pr, state: "DRAFT" }], runs: [] })).toBeNull()
    expect(parseGithubProjectSummary({ prs: [], runs: [{ ...run, status: "flying" }] })).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseGithubProjectSummary(null)).toBeNull()
  })
})

describe("parseGitPullResult", () => {
  it("accepts a well-formed result", () => {
    const result: GitPullResult = { alreadyUpToDate: true, output: "" }
    expect(parseGitPullResult(result)).toEqual(result)
  })

  it("rejects a missing field", () => {
    expect(parseGitPullResult({ alreadyUpToDate: true })).toBeNull()
  })
})

describe("parseGithubPrDiff", () => {
  it("accepts a diff with no warning", () => {
    const diff: GithubPrDiff = { diff: "@@ -1,1 +1,1 @@" }
    expect(parseGithubPrDiff(diff)).toEqual(diff)
  })

  it("accepts an empty diff with a warning", () => {
    const diff: GithubPrDiff = { diff: "", warning: "gh pr diff failed" }
    expect(parseGithubPrDiff(diff)).toEqual(diff)
  })

  it("rejects a non-string diff", () => {
    expect(parseGithubPrDiff({ diff: 1 })).toBeNull()
  })
})
