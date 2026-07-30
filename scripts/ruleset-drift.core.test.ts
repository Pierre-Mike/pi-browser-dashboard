import { describe, expect, it } from "bun:test"
import {
  canonicalJson,
  canonicalValue,
  compareRuleset,
  projectOntoDeclared,
  renderDriftReport,
} from "./ruleset-drift.core"

/** The committed file's shape, trimmed to what the assertions need. */
const committedText = JSON.stringify({
  name: "main protection",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [
          { context: "biome ci (lint + format)" },
          { context: "Playwright" },
        ],
      },
    },
  ],
})

/**
 * What the API actually returns, reproduced from a real
 * `GET /repos/Pierre-Mike/pi-browser-dashboard/rulesets/17605912`: same content,
 * different key order, different array order, plus the server-side fields the
 * committed file does not carry. This is the case that must read as AGREEMENT —
 * if it does not, the check goes red every day and gets muted, and a muted
 * check is worse than no check.
 */
const liveText = JSON.stringify({
  id: 17605912,
  name: "main protection",
  target: "branch",
  source_type: "Repository",
  source: "Pierre-Mike/pi-browser-dashboard",
  enforcement: "active",
  node_id: "RRS_lACqUmVwb3NpdG9yec5J53djzgEMpRg",
  created_at: "2026-06-12T12:23:39.332Z",
  updated_at: "2026-07-30T16:23:14.491Z",
  _links: { self: { href: "https://api.github.com/…" } },
  conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
  rules: [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [
          { context: "Playwright" },
          { context: "biome ci (lint + format)" },
        ],
        strict_required_status_checks_policy: false,
      },
    },
    { type: "deletion" },
  ],
})

describe("canonicalValue", () => {
  it("sorts object keys and is idempotent", () => {
    const once = canonicalValue({ b: 1, a: { d: 2, c: 3 } })
    expect(JSON.stringify(once)).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(canonicalValue(once)).toEqual(once)
  })

  it("sorts arrays so element order carries no meaning", () => {
    expect(canonicalValue(["b", "a", "c"])).toEqual(["a", "b", "c"])
    expect(canonicalValue([{ context: "z" }, { context: "a" }])).toEqual([
      { context: "a" },
      { context: "z" },
    ])
  })

  it("orders equal elements deterministically rather than by comparator luck", () => {
    // A comparator that never returns 0 makes the sort of equal elements
    // implementation-defined; two runs over the same multiset must agree.
    const dupes = [{ a: 1 }, { b: 2 }, { a: 1 }]
    expect(canonicalJson(dupes)).toBe(canonicalJson([{ a: 1 }, { a: 1 }, { b: 2 }]))
  })

  it("leaves primitives and nulls alone", () => {
    expect(canonicalValue(null)).toBeNull()
    expect(canonicalValue(7)).toBe(7)
    expect(canonicalValue("x")).toBe("x")
  })
})

describe("projectOntoDeclared", () => {
  it("drops keys the declared side does not have, at any object depth", () => {
    expect(
      projectOntoDeclared({
        declared: { a: 1, nested: { keep: 1 } },
        live: { a: 1, id: 99, nested: { keep: 1, node_id: "x" } },
      }),
    ).toEqual({ a: 1, nested: { keep: 1 } })
  })

  it("does not reach inside arrays — a pairing heuristic could hide real drift", () => {
    expect(
      projectOntoDeclared({
        declared: { rules: [{ type: "deletion" }] },
        live: { rules: [{ type: "deletion", added_by_github: true }] },
      }),
    ).toEqual({ rules: [{ type: "deletion", added_by_github: true }] })
  })

  it("omits a declared key the live side is missing, so a deleted rule reads as drift", () => {
    expect(projectOntoDeclared({ declared: { a: 1, b: 2 }, live: { a: 1 } })).toEqual({ a: 1 })
  })
})

describe("compareRuleset", () => {
  it("calls the real API payload agreement despite key, array and field noise", () => {
    const verdict = compareRuleset({ committed: committedText, live: liveText })
    expect(verdict.kind).toBe("agree")
  })

  it("reports a changed enforcement mode", () => {
    const live = JSON.stringify({ ...JSON.parse(liveText), enforcement: "disabled" })
    const verdict = compareRuleset({ committed: committedText, live })
    expect(verdict.kind).toBe("drift")
    if (verdict.kind !== "drift") return
    expect(verdict.removed.join("\n")).toContain('"enforcement": "active"')
    expect(verdict.added.join("\n")).toContain('"enforcement": "disabled"')
  })

  it("reports a required status check removed through the UI", () => {
    const parsedLive = JSON.parse(liveText) as {
      rules: Array<{ type: string; parameters?: { required_status_checks?: unknown[] } }>
    }
    const statusRule = parsedLive.rules.find((r) => r.type === "required_status_checks")
    if (statusRule?.parameters !== undefined) {
      statusRule.parameters.required_status_checks = [{ context: "Playwright" }]
    }
    const verdict = compareRuleset({ committed: committedText, live: JSON.stringify(parsedLive) })
    expect(verdict.kind).toBe("drift")
    if (verdict.kind !== "drift") return
    expect(verdict.removed.join("\n")).toContain("biome ci (lint + format)")
  })

  it("reports a whole rule deleted", () => {
    const parsedLive = JSON.parse(liveText) as { rules: Array<{ type: string }> }
    const verdict = compareRuleset({
      committed: committedText,
      live: JSON.stringify({
        ...parsedLive,
        rules: parsedLive.rules.filter((r) => r.type !== "deletion"),
      }),
    })
    expect(verdict.kind).toBe("drift")
  })

  // A field GitHub adds inside an array is deliberately NOT absorbed: see the
  // module header. Noisy in the rare case, never blind in the dangerous one.
  it("surfaces an unexpected array-nested field rather than silently absorbing it", () => {
    const parsedLive = JSON.parse(liveText) as { rules: Array<Record<string, unknown>> }
    const verdict = compareRuleset({
      committed: committedText,
      live: JSON.stringify({
        ...parsedLive,
        rules: parsedLive.rules.map((r) =>
          r.type === "deletion" ? { ...r, some_future_field: true } : r,
        ),
      }),
    })
    expect(verdict.kind).toBe("drift")
  })

  it("treats a missing ruleset as the most serious drift, not as an error", () => {
    const verdict = compareRuleset({ committed: committedText, live: "null" })
    expect(verdict.kind).toBe("drift")
    if (verdict.kind !== "drift") return
    expect(verdict.summary).toContain("protects nothing")
  })

  // The whole point of the `unreadable` arm: a bad read must never be able to
  // close an open drift issue by looking like agreement.
  it("never calls an unparseable or non-object response agreement", () => {
    expect(compareRuleset({ committed: committedText, live: "<html>502</html>" }).kind).toBe(
      "unreadable",
    )
    expect(compareRuleset({ committed: committedText, live: "[]" }).kind).toBe("unreadable")
    expect(compareRuleset({ committed: "{", live: liveText }).kind).toBe("unreadable")
  })
})

// The alarm is the deliverable here, not a side effect: a report nobody can
// read fails in exactly the same way as no report, and nobody finds that out
// until the day it fires.
describe("renderDriftReport", () => {
  const driftReport = (): string => {
    const live = JSON.stringify({ ...JSON.parse(liveText), enforcement: "disabled" })
    return renderDriftReport({ verdict: compareRuleset({ committed: committedText, live }) })
  }

  it("names what is committed-only and what is live-only, in fenced diff blocks", () => {
    const body = driftReport()
    expect(body).toContain("Committed in `.github/rulesets/main.json` but NOT live")
    expect(body).toContain('-   "enforcement": "active"')
    expect(body).toContain('+   "enforcement": "disabled"')
    expect(body).toContain("```diff")
  })

  it("carries both full canonical documents so a reader can diff them by eye", () => {
    const body = driftReport()
    expect(body).toContain("<details><summary>Full canonical documents</summary>")
    expect(body).toContain("```json")
    expect(body).toContain("</details>")
  })

  it("says so plainly when there is nothing to report", () => {
    const verdict = compareRuleset({ committed: committedText, live: liveText })
    expect(renderDriftReport({ verdict })).toContain("matches the committed one")
  })

  it("renders the reason when the comparison could not be made", () => {
    const verdict = compareRuleset({ committed: committedText, live: "nope" })
    expect(renderDriftReport({ verdict })).toContain("could not be made")
  })
})
