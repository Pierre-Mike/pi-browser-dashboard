#!/usr/bin/env bun
/**
 * Turn eval result files into something you can act on.
 *
 *   bun run evals:report evals/results/<runId>.json          # score one run
 *   bun run evals:report -- --compare base.json cand.json    # A/B a change
 *   bun run evals:report -- --score run.json                 # bare mean score
 *
 * Two questions get answered. "Which model is enough?" — the model table ranks
 * by score and by cost-per-point, so a cheap model that fails half the grid
 * stops looking cheap. "Did my harness change actually help?" — compare mode
 * judges each task against a 2σ noise floor built from the repeats, because a
 * single run of a stochastic agent proves nothing.
 *
 * A baseline run (`run.ts --baseline`, no agent) is scored too: any task whose
 * asserts pass with nobody doing the work is flagged as measuring nothing.
 */
import type { CellResult } from "./score.core"
import {
  costPerPoint,
  mean,
  NO_OP_SCORE,
  scoreOf,
  summariseByModel,
  summariseByTask,
  trivialTasks,
  verdictOf,
} from "./score.core"

/**
 * Every field is total: `readRun` below fills a default for anything missing, so
 * the render never re-asks "and what if this one is undefined?" — a habit that
 * had `headline` branching five ways over its own inputs.
 */
interface RunFile {
  readonly runId: string
  readonly label: string
  readonly suite: string
  readonly models: ReadonlyArray<string>
  readonly repeats: number
  readonly baseline: boolean
  readonly ref: string
  readonly permissionMode: string
  readonly gates: ReadonlyArray<string>
  readonly cells: ReadonlyArray<CellResult>
}

const argv = Bun.argv.slice(2)

/**
 * A run file is our own output, but it is still untrusted input by the time it
 * comes back off disk (hand-edited, half-written by a crashed run, or from an
 * older schema). So: parse, don't cast — the repo bans
 * `(await res.json()) as T` for exactly this reason, and a report that reads a
 * truncated file should say so rather than throw `undefined is not an object`
 * three frames deep.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const str = (input: { readonly from: Record<string, unknown>; readonly key: string }): string => {
  const value = input.from[input.key]
  return typeof value === "string" ? value : ""
}

const num = (input: {
  readonly from: Record<string, unknown>
  readonly key: string
  readonly fallback: number
}): number => {
  const value = input.from[input.key]
  return typeof value === "number" ? value : input.fallback
}

const strings = (input: {
  readonly from: Record<string, unknown>
  readonly key: string
}): ReadonlyArray<string> => {
  const value = input.from[input.key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

const parseCheck = (raw: unknown): CellResult["checks"][number] | null => {
  if (!isRecord(raw)) return null
  const kind = str({ from: raw, key: "kind" })
  if (kind !== "gate" && kind !== "assert") return null
  return {
    name: str({ from: raw, key: "name" }),
    kind,
    ok: raw.ok === true,
    ms: num({ from: raw, key: "ms", fallback: 0 }),
  }
}

const parseCell = (raw: unknown): CellResult | null => {
  if (!isRecord(raw)) return null
  const checks = Array.isArray(raw.checks)
    ? raw.checks
        .map(parseCheck)
        .filter((check): check is CellResult["checks"][number] => check !== null)
    : []
  const agentError = raw.agentError
  return {
    taskId: str({ from: raw, key: "taskId" }),
    archetype: str({ from: raw, key: "archetype" }),
    model: str({ from: raw, key: "model" }),
    repeat: num({ from: raw, key: "repeat", fallback: 0 }),
    checks,
    costUsd: num({ from: raw, key: "costUsd", fallback: 0 }),
    durationMs: num({ from: raw, key: "durationMs", fallback: 0 }),
    turns: num({ from: raw, key: "turns", fallback: 0 }),
    filesChanged: num({ from: raw, key: "filesChanged", fallback: 0 }),
    linesChanged: num({ from: raw, key: "linesChanged", fallback: 0 }),
    agentError: typeof agentError === "string" ? agentError : null,
  }
}

const readRun = async (path: string): Promise<RunFile> => {
  const raw: unknown = await Bun.file(path).json()
  if (!isRecord(raw)) {
    console.error(`report: ${path} is not an eval run file`)
    process.exit(1)
  }
  const cells = Array.isArray(raw.cells)
    ? raw.cells.map(parseCell).filter((cell): cell is CellResult => cell !== null)
    : []
  return {
    runId: str({ from: raw, key: "runId" }),
    label: str({ from: raw, key: "label" }),
    suite: str({ from: raw, key: "suite" }),
    models: strings({ from: raw, key: "models" }),
    repeats: num({ from: raw, key: "repeats", fallback: 1 }),
    baseline: raw.baseline === true,
    ref: str({ from: raw, key: "ref" }),
    permissionMode: str({ from: raw, key: "permissionMode" }),
    gates: strings({ from: raw, key: "gates" }),
    cells,
  }
}

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`
const usd = (value: number): string => `$${value.toFixed(3)}`
const mins = (ms: number): string => `${(ms / 60_000).toFixed(1)}m`

const row = (cells: ReadonlyArray<string>): string => `| ${cells.join(" | ")} |`

const table = (input: {
  readonly headers: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
}): string =>
  [
    row(input.headers),
    row(input.headers.map(() => "---")),
    ...input.rows.map((cells) => row(cells)),
  ].join("\n")

const modelSection = (cells: ReadonlyArray<CellResult>): string => {
  const summaries = [...summariseByModel(cells)].sort((a, b) => b.meanScore - a.meanScore)
  return table({
    headers: ["model", "cells", "fully green", "mean score", "±σ", "$/cell", "$/point", "min/cell"],
    rows: summaries.map((summary) => [
      summary.model,
      String(summary.cells),
      pct(summary.passRate),
      summary.meanScore.toFixed(3),
      summary.scoreStdev.toFixed(3),
      usd(summary.meanCostUsd),
      Number.isFinite(costPerPoint(summary)) ? usd(costPerPoint(summary)) : "∞",
      mins(summary.meanDurationMs),
    ]),
  })
}

const matrixSection = (cells: ReadonlyArray<CellResult>): string => {
  const rows = summariseByTask(cells)
  const models = [...new Set(cells.map((cell) => cell.model))]
  const taskIds = [...new Set(cells.map((cell) => cell.taskId))]
  return table({
    headers: ["task", "archetype", ...models],
    rows: taskIds.map((taskId) => {
      const forTask = rows.filter((entry) => entry.taskId === taskId)
      return [
        taskId,
        forTask.at(0)?.archetype ?? "",
        ...models.map((model) => {
          const entry = forTask.find((candidate) => candidate.model === model)
          return entry === undefined
            ? "–"
            : `${entry.meanScore.toFixed(2)} (${pct(entry.passRate)})`
        }),
      ]
    }),
  })
}

const failureSection = (cells: ReadonlyArray<CellResult>): string => {
  const rows = summariseByTask(cells).filter((entry) => entry.failedChecks.length > 0)
  if (rows.length === 0) return "_No failing checks._"
  return table({
    headers: ["task", "model", "failed checks"],
    rows: rows.map((entry) => [entry.taskId, entry.model, entry.failedChecks.join("<br>")]),
  })
}

const errorSection = (cells: ReadonlyArray<CellResult>): string => {
  const errored = cells.filter((cell) => cell.agentError !== null)
  if (errored.length === 0) return ""
  return `\n## Agent errors\n\n${table({
    headers: ["task", "model", "error"],
    rows: errored.map((cell) => [cell.taskId, cell.model, cell.agentError ?? ""]),
  })}\n`
}

const trivialSection = (run: RunFile): string => {
  if (!run.baseline) return ""
  const flagged = trivialTasks({ baseline: run.cells })
  if (flagged.length === 0) {
    return `\n**Baseline check: every task sits at the ${NO_OP_SCORE.toFixed(
      2,
    )} do-nothing floor — no assert passes without the work being done, so the grid measures real work.**\n`
  }
  return `\n**Baseline check: these tasks score without an agent — sharpen their asserts.**\n\n${table(
    {
      headers: ["task", "no-op score", "asserts green with no agent"],
      rows: flagged.map((task) => [
        task.taskId,
        task.noOpScore.toFixed(2),
        pct(task.noOpAssertPassRate),
      ]),
    },
  )}\n`
}

const known = (value: string): string => (value === "" ? "?" : value)

const headline = (run: RunFile): string => {
  const suffix = run.baseline ? " · **BASELINE (no agent)**" : ""
  return `suite \`${known(run.suite)}\` · ${run.cells.length} cells · repeats ${run.repeats} · ref \`${known(run.ref)}\` · permission \`${known(run.permissionMode)}\`${suffix}\n\ngates: \`${known(run.gates.join(", "))}\``
}

const titled = (input: { readonly id: string; readonly label: string }): string =>
  input.label === "" ? input.id : `${input.id} — ${input.label}`

const titleOf = (run: RunFile): string =>
  `# Eval run ${titled({ id: run.runId, label: run.label })}`

const single = async (path: string): Promise<string> => {
  const run = await readRun(path)
  const overall = mean(run.cells.map((cell) => scoreOf(cell.checks)))
  const spend = run.cells.reduce((sum, cell) => sum + cell.costUsd, 0)
  return [
    titleOf(run),
    "",
    headline(run),
    "",
    `**mean score ${overall.toFixed(3)} · total spend ${usd(spend)} · do-nothing floor ${NO_OP_SCORE.toFixed(3)}**`,
    trivialSection(run),
    "\n## By model\n",
    modelSection(run.cells),
    "\n## Task × model\n",
    matrixSection(run.cells),
    "\n## What failed\n",
    failureSection(run.cells),
    errorSection(run.cells),
  ].join("\n")
}

const scoresFor = (input: {
  readonly cells: ReadonlyArray<CellResult>
  readonly taskId: string
}): ReadonlyArray<number> =>
  input.cells.filter((cell) => cell.taskId === input.taskId).map((cell) => scoreOf(cell.checks))

const signed = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`

const ADVICE: Readonly<Record<string, string>> = {
  noise:
    "_Inside the noise floor: keep the change only if it is right on its own merits, and add repeats before claiming a win._",
  improved: "_Real improvement: keep it and ratchet the floor._",
  regressed: "_Real regression: revert the harness change._",
}

const named = (run: RunFile): string =>
  `\`${run.runId}\`${run.label === "" ? "" : ` (${run.label})`}`

interface TaskPair {
  readonly taskId: string
  readonly baseScores: ReadonlyArray<number>
  readonly candidateScores: ReadonlyArray<number>
}

const pairedTasks = (input: {
  readonly base: RunFile
  readonly candidate: RunFile
}): ReadonlyArray<TaskPair> => {
  const cells = [...input.base.cells, ...input.candidate.cells]
  return [...new Set(cells.map((cell) => cell.taskId))].map((taskId) => ({
    taskId,
    baseScores: scoresFor({ cells: input.base.cells, taskId }),
    candidateScores: scoresFor({ cells: input.candidate.cells, taskId }),
  }))
}

const ranOnBothSides = (pair: TaskPair): boolean =>
  pair.baseScores.length > 0 && pair.candidateScores.length > 0

const perTaskRow = (pair: TaskPair): ReadonlyArray<string> => {
  const verdict = verdictOf({ base: pair.baseScores, candidate: pair.candidateScores })
  return [
    pair.taskId,
    mean(pair.baseScores).toFixed(2),
    mean(pair.candidateScores).toFixed(2),
    signed(verdict.delta),
    `±${verdict.threshold.toFixed(2)}`,
    verdict.label,
  ]
}

const scoresOfTasks = (input: {
  readonly run: RunFile
  readonly taskIds: ReadonlyArray<string>
}): ReadonlyArray<number> =>
  input.run.cells
    .filter((cell) => input.taskIds.includes(cell.taskId))
    .map((cell) => scoreOf(cell.checks))

/** Two repeats per side is the minimum for a variance estimate; below that the
 * verdict falls back to a blunt minimum delta and says so. */
const repeatsCaveat = (input: { readonly base: RunFile; readonly candidate: RunFile }): string =>
  Math.min(input.base.repeats, input.candidate.repeats) > 1
    ? ""
    : "\n_Fewer than two repeats on one side: the noise floor falls back to a blunt ±0.1 minimum delta. Re-run with `--repeats 3` before trusting this._"

const skippedNote = (skipped: ReadonlyArray<string>): string =>
  skipped.length === 0 ? "" : `\n_Not compared (only one side ran): ${skipped.join(", ")}._`

const compare = async (input: {
  readonly basePath: string
  readonly candidatePath: string
}): Promise<string> => {
  const base = await readRun(input.basePath)
  const candidate = await readRun(input.candidatePath)
  const pairs = pairedTasks({ base, candidate })
  // A task only one side ran is not a regression — it is missing data.
  const bothRan = pairs.filter(ranOnBothSides)
  const taskIds = bothRan.map((pair) => pair.taskId)
  const overall = verdictOf({
    base: scoresOfTasks({ run: base, taskIds }),
    candidate: scoresOfTasks({ run: candidate, taskIds }),
  })
  return [
    "# Eval comparison",
    "",
    `base ${named(base)} → candidate ${named(candidate)}`,
    "",
    `**overall ${signed(overall.delta)} against a ±${overall.threshold.toFixed(3)} noise floor → ${overall.label.toUpperCase()}**`,
    "",
    ADVICE[overall.label] ?? "",
    "",
    table({
      headers: ["task", "base", "candidate", "delta", "noise floor", "verdict"],
      rows: bothRan.map(perTaskRow),
    }),
    repeatsCaveat({ base, candidate }),
    skippedNote(pairs.filter((pair) => !ranOnBothSides(pair)).map((pair) => pair.taskId)),
  ].join("\n")
}

/** `--score` prints the bare mean score — the number a hill-climbing loop reads. */
const scoreOnly = async (path: string): Promise<string> => {
  const run = await readRun(path)
  return mean(run.cells.map((cell) => scoreOf(cell.checks))).toFixed(4)
}

const positional = argv.filter((arg) => !arg.startsWith("--"))

const compareAt = argv.indexOf("--compare")
const comparison = async (): Promise<string> =>
  compare({
    basePath: argv[compareAt + 1] ?? "",
    candidatePath: argv[compareAt + 2] ?? "",
  })

const oneRun = async (): Promise<string> =>
  argv.includes("--score") ? scoreOnly(positional[0] ?? "") : single(positional[0] ?? "")

const text = compareAt === -1 ? await oneRun() : await comparison()

const outAt = argv.indexOf("--out")
if (outAt === -1) await Bun.write(Bun.stdout, `${text}\n`)
else await Bun.write(argv[outAt + 1] ?? "report.md", `${text}\n`)
