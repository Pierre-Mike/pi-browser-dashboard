/**
 * Pure comparison of the COMMITTED branch ruleset against the LIVE one.
 *
 * `bun run doctor` already validates `.github/rulesets/main.json` against the
 * job names the workflows declare — but it is pure and offline, so it cannot
 * ask GitHub whether that file still describes reality. Edit branch protection
 * through the web UI and the committed contract goes stale *silently*: every
 * gate stays green while the governance-as-code story quietly stops being true.
 * This is the comparison that closes that hole; `scripts/check-ruleset-drift.ts`
 * does the I/O and `.github/workflows/ruleset-drift.yml` puts it on a clock.
 *
 * The hard part is not fetching, it is comparing. GitHub returns the ruleset
 * with different key ordering, different array ordering, and server-side fields
 * the committed file has no business carrying (`id`, `node_id`, `source`,
 * `created_at`, `_links`, …). A `diff` or a `jq -S` compare reports drift every
 * single day and gets muted inside a week, at which point the check is worse
 * than nothing — it is a check everyone has learned to ignore. So:
 *
 * 1. **Project** the live payload onto the shape the committed file declares.
 *    Recursive through objects, so `conditions.ref_name.<future field>` is
 *    dropped too, not only the top-level ones.
 * 2. **Canonicalise** both: object keys sorted, arrays sorted by the canonical
 *    JSON of their elements. Every array in a ruleset is a set — required
 *    checks, rules, ref-name includes, merge methods — so ordering carries no
 *    meaning and sorting cannot hide a real difference.
 * 3. Compare the two canonical documents as text.
 *
 * Projection deliberately does NOT reach inside arrays. Pairing array elements
 * across two documents needs a heuristic, and a heuristic that guesses wrong
 * hides real drift. A field GitHub adds inside `rules[]` therefore shows up as
 * drift rather than being silently absorbed — noisy in the rare case, never
 * blind in the dangerous one. The ignore-list is closed by construction: it is
 * exactly "whatever the committed file does not declare, at object level".
 */

export type DriftVerdict =
  /** The committed file and the live ruleset say the same thing. */
  | { readonly kind: "agree"; readonly canonical: string }
  /** They disagree. `removed`/`added` are canonical-JSON lines, committed-first. */
  | {
      readonly kind: "drift"
      readonly summary: string
      readonly committed: string
      readonly live: string
      readonly removed: readonly string[]
      readonly added: readonly string[]
    }
  /**
   * The comparison itself could not be made. NEVER reported as agreement — a
   * malformed response must not close an open drift issue.
   */
  | { readonly kind: "unreadable"; readonly reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const jsonOf = (value: unknown): string => JSON.stringify(value) ?? "null"

const canonicalArray = (value: readonly unknown[]): readonly unknown[] =>
  value
    .map(canonicalValue)
    // A 3-way compare, not `a < b ? -1 : 1`: a comparator that never returns 0
    // leaves equal elements in an implementation-defined order, which would make
    // the canonical form of a document with duplicates non-deterministic.
    .sort((a, b) => (jsonOf(a) < jsonOf(b) ? -1 : jsonOf(a) > jsonOf(b) ? 1 : 0))

const canonicalRecord = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  )

/**
 * Deep-sort a JSON value: object keys alphabetically, array elements by their
 * own canonical JSON. Idempotent, and total over anything `JSON.parse` returns.
 */
export const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return canonicalArray(value)
  if (isRecord(value)) return canonicalRecord(value)
  return value
}

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalValue(value), null, 2) ?? "null"

/**
 * Keep only what `declared` declares. Recursive through objects; arrays and
 * primitives pass through untouched (see the header for why arrays are left
 * alone). A key the declared side has and the live side lacks survives as
 * `undefined`, which canonicalises to a missing key on the live document —
 * i.e. it shows up as drift, which is correct: the rule is gone.
 */
const projectRecord = (input: {
  readonly declared: Record<string, unknown>
  readonly live: Record<string, unknown>
}): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(input.declared)
      .filter((key) => key in input.live)
      .map((key) => [
        key,
        projectOntoDeclared({ declared: input.declared[key], live: input.live[key] }),
      ]),
  )

export const projectOntoDeclared = (input: {
  readonly declared: unknown
  readonly live: unknown
}): unknown =>
  isRecord(input.declared) && isRecord(input.live)
    ? projectRecord({ declared: input.declared, live: input.live })
    : input.live

const parsed = (input: { readonly text: string }): { readonly value: unknown } | null => {
  try {
    return { value: JSON.parse(input.text) as unknown }
  } catch {
    return null
  }
}

const lineCounts = (text: string): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const line of text.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

/**
 * Lines in `from` that `to` does not have, as a MULTISET difference — a line
 * repeated three times on one side and once on the other reports twice, which a
 * set difference would silently call equal.
 */
const missingLines = (input: { readonly from: string; readonly to: string }): readonly string[] => {
  const pool = lineCounts(input.to)
  return input.from.split("\n").filter((line) => {
    const left = pool.get(line) ?? 0
    pool.set(line, left - 1)
    return left <= 0
  })
}

type Sides =
  | { readonly kind: "read"; readonly declared: Record<string, unknown>; readonly remote: unknown }
  | { readonly kind: "unreadable"; readonly reason: string }

const readSides = (input: { readonly committed: string; readonly live: string }): Sides => {
  const declared = parsed({ text: input.committed })
  if (declared === null || !isRecord(declared.value)) {
    return {
      kind: "unreadable",
      reason: ".github/rulesets/main.json is missing or is not a JSON object",
    }
  }
  const remote = parsed({ text: input.live })
  if (remote === null) {
    return { kind: "unreadable", reason: "the live ruleset response is not parseable JSON" }
  }
  return { kind: "read", declared: declared.value, remote: remote.value }
}

const nameOf = (declared: Record<string, unknown>): string =>
  typeof declared.name === "string" ? declared.name : "(unnamed)"

/** No ruleset with the committed name exists. The loudest thing this can say. */
const absentRuleset = (input: { readonly declared: Record<string, unknown> }): DriftVerdict => {
  const committed = canonicalJson(input.declared)
  return {
    kind: "drift",
    summary: `no ruleset named "${nameOf(input.declared)}" exists on GitHub — the committed contract protects nothing`,
    committed,
    live: "null",
    removed: committed.split("\n"),
    added: [],
  }
}

const compareShapes = (input: {
  readonly declared: Record<string, unknown>
  readonly remote: Record<string, unknown>
}): DriftVerdict => {
  const committed = canonicalJson(input.declared)
  const live = canonicalJson(projectOntoDeclared({ declared: input.declared, live: input.remote }))
  if (committed === live) return { kind: "agree", canonical: committed }
  return {
    kind: "drift",
    summary: `the live ruleset "${nameOf(input.declared)}" no longer matches .github/rulesets/main.json`,
    committed,
    live,
    removed: missingLines({ from: committed, to: live }),
    added: missingLines({ from: live, to: committed }),
  }
}

/**
 * Compare the committed ruleset file against the live API payload.
 *
 * `live` is the JSON text of `GET /repos/{owner}/{repo}/rulesets/{id}`, or the
 * literal `null` when no ruleset with the committed name exists — which is
 * drift of the most serious kind and is reported as such, not as an error.
 */
export const compareRuleset = (input: {
  readonly committed: string
  readonly live: string
}): DriftVerdict => {
  const sides = readSides(input)
  if (sides.kind === "unreadable") return sides
  if (sides.remote === null) return absentRuleset({ declared: sides.declared })
  if (!isRecord(sides.remote)) {
    return { kind: "unreadable", reason: "the live ruleset response is not a JSON object" }
  }
  return compareShapes({ declared: sides.declared, remote: sides.remote })
}

const fenced = (input: {
  readonly lang: string
  readonly body: readonly string[]
}): readonly string[] => [`\`\`\`${input.lang}`, ...input.body, "```", ""]

/**
 * The drift report, as markdown, ready to be an issue body. Pure so the shape
 * of the alarm is testable — an alarm nobody can read is the same failure as no
 * alarm, and it is not the sort of thing anyone notices until the day it fires.
 */
export const renderDriftReport = (input: { readonly verdict: DriftVerdict }): string => {
  const { verdict } = input
  if (verdict.kind === "agree") return "The live ruleset matches the committed one.\n"
  if (verdict.kind === "unreadable") {
    return `The comparison could not be made: ${verdict.reason}\n`
  }
  return [
    `## ${verdict.summary}`,
    "",
    "Committed in `.github/rulesets/main.json` but NOT live on GitHub:",
    "",
    ...fenced({ lang: "diff", body: verdict.removed.map((line) => `- ${line}`) }),
    "Live on GitHub but NOT committed:",
    "",
    ...fenced({ lang: "diff", body: verdict.added.map((line) => `+ ${line}`) }),
    "<details><summary>Full canonical documents</summary>",
    "",
    "Committed:",
    "",
    ...fenced({ lang: "json", body: verdict.committed.split("\n") }),
    "Live, projected onto the committed shape:",
    "",
    ...fenced({ lang: "json", body: verdict.live.split("\n") }),
    "</details>",
    "",
  ].join("\n")
}
