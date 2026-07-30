#!/usr/bin/env bun
/**
 * `bun scripts/check-ruleset-drift.ts <committed.json> <live.json> <report.md>`
 *
 * Compares the committed branch ruleset against a live one the caller has
 * already fetched, writes the markdown report, and reports the verdict through
 * the exit code:
 *
 *   0  they agree
 *   1  they DRIFTED — the workflow turns this into an issue, not a red run
 *   2  the comparison could not be made — the workflow FAILS on this
 *
 * The 1-vs-2 split is the whole contract. A 502, a truncated body or a token
 * that lost its read must never come out as "they agree" and close an open
 * drift issue — and must not come out as "they drifted" either, because an
 * alarm nobody can act on decays the same way a red badge does.
 *
 * The fetch deliberately lives in the workflow, where `gh` is already
 * authenticated and a failed API call fails its own step. This file stays a
 * thin shell over `ruleset-drift.core.ts`, which does the comparison and
 * renders the report; both are pure and unit-tested.
 */
import { compareRuleset, renderDriftReport } from "./ruleset-drift.core"

const [committedPath, livePath, reportPath] = process.argv.slice(2)

if (committedPath === undefined || livePath === undefined || reportPath === undefined) {
  console.error("usage: check-ruleset-drift.ts <committed.json> <live.json> <report.md>")
  process.exit(2)
}

const readOrEmpty = async (path: string): Promise<string> =>
  Bun.file(path)
    .text()
    .catch(() => "")

const verdict = compareRuleset({
  committed: await readOrEmpty(committedPath),
  live: await readOrEmpty(livePath),
})

await Bun.write(reportPath, renderDriftReport({ verdict }))

if (verdict.kind === "unreadable") {
  console.error(`✖ ruleset drift check could not run: ${verdict.reason}`)
  process.exit(2)
}

if (verdict.kind === "agree") {
  console.error("✓ the live ruleset matches .github/rulesets/main.json")
  process.exit(0)
}

console.error(`✖ ruleset drift: ${verdict.summary}`)
console.error(`  report written to ${reportPath}`)
process.exit(1)
