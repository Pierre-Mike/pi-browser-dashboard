import { describe, expect, it } from "bun:test"
import {
  type Issue,
  type SchedulerState,
  branchName,
  formatTddPrompt,
  goalText,
  isVagueIssue,
  issueKey,
  parseIssueListJson,
  pickEligible,
  slugify,
} from "./issue-driver.core"

const makeIssue = (over: Partial<Issue> = {}): Issue => {
  const number = over.number ?? 1
  const repo = over.repo ?? "acme/widgets"
  return {
    number,
    title: "Add thing",
    body: "We need a thing.",
    labels: ["claude-go"],
    repo,
    url: `https://github.com/${repo}/issues/${number}`,
    ...over,
  }
}

const emptyState = (): SchedulerState => ({ running: new Map(), processed: new Set() })

describe("issueKey", () => {
  it("joins repo and number with a hash", () => {
    expect(issueKey({ repo: "acme/widgets", number: 42 })).toBe("acme/widgets#42")
  })
})

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric runs with dashes", () => {
    expect(slugify("Add Login & Signup!")).toBe("add-login-signup")
  })

  it("trims leading and trailing dashes", () => {
    expect(slugify("  ---hello world---  ")).toBe("hello-world")
  })

  it("collapses long titles to the requested max length on a word boundary", () => {
    const out = slugify("This is a very long issue title that should be cut", 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.endsWith("-")).toBe(false)
  })

  it("falls back to 'issue' for fully non-alphanumeric input", () => {
    expect(slugify("???")).toBe("issue")
  })
})

describe("branchName", () => {
  it("formats as issue/<n>-<slug>", () => {
    expect(branchName({ number: 42, title: "Add Login" })).toBe("issue/42-add-login")
  })
})

describe("parseIssueListJson", () => {
  it("parses gh issue list --json output with repository", () => {
    const raw = JSON.stringify([
      {
        number: 7,
        title: "Bug",
        body: "broken",
        labels: [{ name: "bug" }, { name: "claude-go" }],
        url: "https://github.com/acme/widgets/issues/7",
        repository: { nameWithOwner: "acme/widgets" },
      },
    ])
    const out = parseIssueListJson(raw)
    expect(out).toEqual([
      {
        number: 7,
        title: "Bug",
        body: "broken",
        labels: ["bug", "claude-go"],
        repo: "acme/widgets",
        url: "https://github.com/acme/widgets/issues/7",
      },
    ])
  })

  it("uses fallbackRepo when payload lacks repository", () => {
    const raw = JSON.stringify([{ number: 1, title: "T", body: "", labels: [], url: "u" }])
    const out = parseIssueListJson(raw, "owner/repo")
    expect(out[0]?.repo).toBe("owner/repo")
  })

  it("returns empty array on invalid JSON", () => {
    expect(parseIssueListJson("not json", "owner/repo")).toEqual([])
  })

  it("skips entries with no number", () => {
    const raw = JSON.stringify([{ title: "no number" }])
    expect(parseIssueListJson(raw, "owner/repo")).toEqual([])
  })
})

describe("goalText", () => {
  it("starts with /goal and includes title, body, and issue url", () => {
    const out = goalText(makeIssue({ number: 9, title: "Add X", body: "do it" }))
    expect(out.startsWith("/goal ")).toBe(true)
    expect(out).toContain("Add X")
    expect(out).toContain("do it")
    expect(out).toContain("https://github.com/acme/widgets/issues/9")
  })
})

describe("formatTddPrompt", () => {
  it("embeds repo and issue number for gh commenting", () => {
    const out = formatTddPrompt({ repo: "acme/widgets", issueNumber: 5 })
    expect(out).toContain("acme/widgets")
    expect(out).toContain("#5")
    // Mentions all four phases.
    expect(out.toLowerCase()).toContain("failing test")
    expect(out.toLowerCase()).toContain("refactor")
    expect(out.toLowerCase()).toContain("draft")
  })
})

describe("isVagueIssue", () => {
  it("flags a body shorter than 20 chars", () => {
    expect(isVagueIssue({ title: "x", body: "" })).toBe(true)
    expect(isVagueIssue({ title: "x", body: "make it faster" })).toBe(true)
  })

  it("accepts a substantial body", () => {
    expect(
      isVagueIssue({
        title: "x",
        body: "Given a logged-out user, when they visit /login, they should see a form.",
      }),
    ).toBe(false)
  })
})

describe("pickEligible", () => {
  it("returns issues up to globalCap, skipping already-processed", () => {
    const a = makeIssue({ number: 1, repo: "o/a" })
    const b = makeIssue({ number: 2, repo: "o/b" })
    const c = makeIssue({ number: 3, repo: "o/c" })
    const state: SchedulerState = {
      running: new Map(),
      processed: new Set([issueKey(a)]),
    }
    const picked = pickEligible({ issues: [a, b, c], state, globalCap: 2, perRepoCap: 1 })
    expect(picked.map((i) => i.number)).toEqual([2, 3])
  })

  it("respects perRepoCap so two issues from the same repo don't both start", () => {
    const a = makeIssue({ number: 1, repo: "o/same" })
    const b = makeIssue({ number: 2, repo: "o/same" })
    const c = makeIssue({ number: 3, repo: "o/other" })
    const picked = pickEligible({
      issues: [a, b, c],
      state: emptyState(),
      globalCap: 3,
      perRepoCap: 1,
    })
    expect(picked.map((i) => i.number)).toEqual([1, 3])
  })

  it("excludes issues already running", () => {
    const a = makeIssue({ number: 1, repo: "o/a" })
    const b = makeIssue({ number: 2, repo: "o/b" })
    const state: SchedulerState = {
      running: new Map([[issueKey(a), a.repo]]),
      processed: new Set(),
    }
    const picked = pickEligible({ issues: [a, b], state, globalCap: 2, perRepoCap: 1 })
    expect(picked.map((i) => i.number)).toEqual([2])
  })

  it("respects globalCap with one already running", () => {
    const running = makeIssue({ number: 0, repo: "o/r0" })
    const a = makeIssue({ number: 1, repo: "o/a" })
    const b = makeIssue({ number: 2, repo: "o/b" })
    const state: SchedulerState = {
      running: new Map([[issueKey(running), running.repo]]),
      processed: new Set(),
    }
    const picked = pickEligible({
      issues: [a, b],
      state,
      globalCap: 2,
      perRepoCap: 1,
    })
    expect(picked.map((i) => i.number)).toEqual([1])
  })
})
