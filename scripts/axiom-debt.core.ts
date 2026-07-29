/**
 * Pure scanner for the axioms this repo cannot yet enforce as a hard lint
 * error everywhere, because the existing codebase already violates them in bulk:
 *
 *   1. `cross-slice-import` — a feature slice reaching into a sibling slice's
 *      internals instead of a published door (modular monolith).
 *   2. `env-outside-config`  — reading `process.env` outside the typed config
 *      funnel (typed config at boot).
 *   3. `raw-fetch`           — calling `fetch` outside a `*.io.ts` port.
 *
 * Turning any of these into a Biome error today would fail CI on existing
 * sites, so the alternative would be to document them and hope. Instead they
 * are ratcheted: `scripts/axiom-debt.json` records the exact per-file counts,
 * and any difference — a new violation *or* a fixed one — fails the gate until
 * the baseline is updated. New code therefore cannot add debt silently, and
 * every repayment is a visible line in a diff.
 *
 * A ratchet is meant to end. `json-cast` — casting `.json()` instead of decoding
 * it — used to be the fourth class here, with ~40 sites in `apps/web` awaiting a
 * contract to decode against. Those are gone: `shared/src` now holds the
 * contracts, `apps/web` has local pure parsers for the shapes that are genuinely
 * web-only, and `biome-plugins/no-cast-json.grit` is a hard error across every
 * workspace. That is the shape of a successful ratchet — the count reaches zero
 * and the class is deleted in favour of a lint rule, because a lint rule cannot
 * be paid back down.
 *
 * Pure by construction: paths and file contents in, findings out. The shell
 * (scripts/check-axiom-debt.ts) does the reading, comparing and exiting.
 */

type DebtClass = "cross-slice-import" | "env-outside-config" | "raw-fetch"

const DEBT_CLASSES: readonly DebtClass[] = ["cross-slice-import", "env-outside-config", "raw-fetch"]

export type SourceFile = { readonly path: string; readonly text: string }

/** class -> repo-relative path -> number of violating occurrences. */
export type DebtBaseline = Readonly<Record<string, Readonly<Record<string, number>>>>

const isTest = (path: string): boolean => /\.(test|spec)\.tsx?$/.test(path)
const isIoPort = (path: string): boolean => /\.io\.tsx?$/.test(path)

// Composition roots and configs are allowed to read the environment: they are
// the one place where "outside" enters the program.
const ENV_SANCTIONED = [
  /(^|\/)main\.ts$/,
  /^apps\/daemon\/src\/server\.ts$/,
  /(^|\/)platform\/config\.io\.ts$/,
  /(^|\/)platform\/config-dir\.ts$/,
  /^scripts\//,
  /^apps\/e2e\//,
  /(^|\/)(vite|playwright)\.config\.ts$/,
]

const countMatches = ({ text, re }: { readonly text: string; readonly re: RegExp }): number =>
  [...text.matchAll(re)].length

// `from "../<slice>/<file>.<tier>"` — a relative hop *out* of the current slice
// and straight into a sibling's internals.
const CROSS_SLICE = /from\s+["']\.\.\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\.(core|io|routes)["']/g

const sliceOf = (path: string): string | null => {
  const m = /(?:^|\/)features\/([^/]+)\//.exec(path)
  return m?.[1] ?? null
}

export const countCrossSliceImports = (file: SourceFile): number => {
  const own = sliceOf(file.path)
  if (own === null) return 0
  let n = 0
  for (const m of file.text.matchAll(CROSS_SLICE)) {
    if (m[1] !== own) n += 1
  }
  return n
}

export const countEnvReads = (file: SourceFile): number => {
  if (isTest(file.path)) return 0
  if (ENV_SANCTIONED.some((re) => re.test(file.path))) return 0
  return countMatches({ text: file.text, re: /\bprocess\.env\b/g })
}

export const countRawFetches = (file: SourceFile): number => {
  if (isTest(file.path) || isIoPort(file.path)) return 0
  // `fetch(` as a bare call — not `foo.fetch(`, not `finalApp.fetch`.
  return countMatches({ text: file.text, re: /(?<![.\w$])fetch\s*\(/g })
}

const COUNTERS: Readonly<Record<DebtClass, (file: SourceFile) => number>> = {
  "cross-slice-import": countCrossSliceImports,
  "env-outside-config": countEnvReads,
  "raw-fetch": countRawFetches,
}

/** Scan every file once per class; omit zero counts so the baseline stays terse. */
export const scanDebt = (files: readonly SourceFile[]): DebtBaseline => {
  const out: Record<string, Record<string, number>> = {}
  for (const cls of DEBT_CLASSES) {
    const perFile: Record<string, number> = {}
    for (const file of files) {
      const n = COUNTERS[cls](file)
      if (n > 0) perFile[file.path] = n
    }
    out[cls] = perFile
  }
  return out
}

export type DebtDrift = {
  readonly cls: string
  readonly path: string
  readonly baseline: number
  readonly actual: number
}

/**
 * Compare a fresh scan against the recorded baseline. Both directions drift:
 * a regression must fail, and a repayment must be locked into the baseline
 * file so the number can only go down over time.
 */
export const diffDebt = ({
  baseline,
  actual,
}: {
  readonly baseline: DebtBaseline
  readonly actual: DebtBaseline
}): readonly DebtDrift[] => {
  const drift: DebtDrift[] = []
  const classes = [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort()
  for (const cls of classes) {
    const before = baseline[cls] ?? {}
    const after = actual[cls] ?? {}
    const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const path of paths) {
      const b = before[path] ?? 0
      const a = after[path] ?? 0
      if (a !== b) drift.push({ cls, path, baseline: b, actual: a })
    }
  }
  return drift
}

export const totalDebt = (baseline: DebtBaseline): number =>
  Object.values(baseline)
    .flatMap((perFile) => Object.values(perFile))
    .reduce((sum, n) => sum + n, 0)
