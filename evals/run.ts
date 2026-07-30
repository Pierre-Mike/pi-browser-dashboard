#!/usr/bin/env bun
/**
 * Golden-task agent evals — regression-test the HARNESS, not just the code.
 *
 * Every cell is one (task × model × repeat): a throwaway git worktree, a
 * headless `claude -p` attempt, then judgment by two independent juries — the
 * repo's own gates (whatever `bun run verify` composes) and the task's
 * functional asserts (evals/tasks.jsonl, mostly real traffic through
 * evals/probe.ts).
 *
 * Gates alone cannot be the judge, and that is the whole reason this file
 * exists: `bun run verify` is green on an untouched checkout, so the eval this
 * replaces — "hand the task to an agent, pass iff verify is green" — scored an
 * agent that did *nothing* a perfect 1.0. Prove it for yourself, for free:
 * `bun run evals:baseline` runs the entire grid with no agent at all and reports
 * what each task is worth without work.
 *
 *   bun run evals -- --suite smoke --models sonnet
 *   bun run evals -- --suite full --models opus,sonnet,haiku --repeats 3
 *   bun run evals:baseline                       # no agent, no tokens, no cost
 *   bun run evals:report evals/results/<runId>.json
 *
 * Results land in evals/results/<runId>.json (scores, cost, turns, churn) with
 * each agent's raw transcript beside them, so two runs can be compared with
 * `evals/report.ts --compare a.json b.json` against a 2σ noise floor rather
 * than vibes.
 *
 * The agent runs with `--setting-sources project`: an eval must measure THIS
 * repo's harness, not whatever personal skills and CLAUDE.md the operator has
 * installed. Permission mode defaults to bypassPermissions because the target
 * is a disposable worktree under $TMPDIR and permission friction would
 * otherwise be scored as model incapability.
 */
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gatesOf } from "./gates.core"
import type { CellResult, CheckResult } from "./score.core"
import { isPass, NO_OP_SCORE, scoreOf } from "./score.core"

// --- task set --------------------------------------------------------------

interface TaskAssert {
  readonly name: string
  readonly run: string
}

interface Task {
  readonly id: string
  readonly archetype: string
  readonly difficulty: string
  readonly suites: ReadonlyArray<string>
  readonly prompt: string
  readonly asserts: ReadonlyArray<TaskAssert>
}

/** Friendly name -> pinned model id. Anything else is passed through as-is. */
const MODEL_IDS: Readonly<Record<string, string>> = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
  fable: "claude-fable-5",
}

const argv = Bun.argv.slice(2)

const flag = (input: { readonly name: string; readonly fallback: string }): string => {
  const at = argv.indexOf(`--${input.name}`)
  return at === -1 ? input.fallback : (argv[at + 1] ?? input.fallback)
}

const numberFlag = (input: { readonly name: string; readonly fallback: number }): number => {
  const raw = Number(flag({ name: input.name, fallback: String(input.fallback) }))
  return Number.isFinite(raw) ? raw : input.fallback
}

const hasFlag = (name: string): boolean => argv.includes(`--${name}`)

const list = (raw: string): ReadonlyArray<string> =>
  raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

// --- shell -----------------------------------------------------------------

interface Ran {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly ms: number
  readonly timedOut: boolean
}

const GRACE_MS = 15_000

/**
 * A give-up timer that does NOT hold the event loop open — a plain
 * `Bun.sleep(30 minutes)` in a losing race keeps the runner alive long after
 * the grid has been written.
 */
const giveUpAfter = <T>(input: { readonly ms: number; readonly value: T }): Promise<T> =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(input.value), input.ms)
    const unrefable: { unref?: () => void } = timer
    unrefable.unref?.()
  })

/**
 * Killing a process does NOT close pipes its grandchildren inherited. This repo
 * spawns daemons, zellij panes and browsers, so an agent whose test leaves one
 * running keeps stdout open forever — and a plain
 * `await new Response(proc.stdout).text()` would hang the entire grid on that
 * one cell. Every read is therefore raced against a grace period past the kill:
 * the exit code and the timeout flag are what scoring needs; output is
 * best-effort.
 */
const readOrGiveUp = async (input: {
  readonly stream: ReadableStream<Uint8Array> | null
  readonly budgetMs: number
}): Promise<string> => {
  if (input.stream === null) return ""
  const text = new Response(input.stream).text()
  return Promise.race([text, giveUpAfter({ ms: input.budgetMs, value: "" })]).catch(() => "")
}

const shell = async (input: {
  readonly cmd: ReadonlyArray<string>
  readonly cwd: string
  readonly timeoutMs: number
  readonly env?: Record<string, string>
}): Promise<Ran> => {
  const startedNs = Bun.nanoseconds()
  const proc = Bun.spawn([...input.cmd], {
    cwd: input.cwd,
    env: { ...Bun.env, ...(input.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  let timedOut = false
  const killer = setTimeout(() => {
    timedOut = true
    proc.kill(9)
  }, input.timeoutMs)
  const budgetMs = input.timeoutMs + GRACE_MS
  const [stdout, stderr, code] = await Promise.all([
    readOrGiveUp({ stream: proc.stdout, budgetMs }),
    readOrGiveUp({ stream: proc.stderr, budgetMs }),
    Promise.race([proc.exited, giveUpAfter({ ms: budgetMs, value: 124 })]),
  ])
  clearTimeout(killer)
  return { code, stdout, stderr, ms: (Bun.nanoseconds() - startedNs) / 1e6, timedOut }
}

const sh = async (input: {
  readonly script: string
  readonly cwd: string
  readonly timeoutMs: number
}): Promise<Ran> =>
  shell({ cmd: ["sh", "-c", input.script], cwd: input.cwd, timeoutMs: input.timeoutMs })

// --- the repo under test ---------------------------------------------------

const repoRoot = (
  await shell({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: import.meta.dir,
    timeoutMs: 10_000,
  })
).stdout.trim()

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>
}

const readScripts = async (): Promise<Readonly<Record<string, string>>> => {
  const parsed: unknown = await Bun.file(join(repoRoot, "package.json")).json()
  if (typeof parsed !== "object" || parsed === null) return {}
  const scripts = (parsed as PackageJson).scripts
  return scripts ?? {}
}

/**
 * The gate jury, derived from `verify` in the runner's own checkout — not from
 * the cell's, which an agent could edit to shrink its own jury. A gate whose
 * script an agent deletes still runs here and fails, which is the correct
 * scoring: deleting a gate is breaking the repo.
 */
const GATES = gatesOf({ scripts: await readScripts(), fallback: ["test"] })

// --- worktrees -------------------------------------------------------------

const addWorktree = async (input: {
  readonly dir: string
  readonly ref: string
  readonly dirty: boolean
}): Promise<void> => {
  const added = await shell({
    cmd: ["git", "worktree", "add", "--detach", input.dir, input.ref],
    cwd: repoRoot,
    timeoutMs: 120_000,
  })
  if (added.code !== 0) throw new Error(`git worktree add failed: ${added.stderr}`)
  if (!input.dirty) return
  // --dirty: replay uncommitted work (tracked diff + untracked files) so a
  // harness change can be scored BEFORE it is committed.
  const patch = join(input.dir, ".eval-dirty.patch")
  await sh({
    script: `git -C ${repoRoot} diff HEAD > ${patch} && (test -s ${patch} && git apply ${patch} || true) && rm -f ${patch}`,
    cwd: input.dir,
    timeoutMs: 120_000,
  })
  await sh({
    script: `git -C ${repoRoot} ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do mkdir -p "$(dirname "$f")" && cp "${repoRoot}/$f" "$f"; done`,
    cwd: input.dir,
    timeoutMs: 120_000,
  })
}

const removeWorktree = async (dir: string): Promise<void> => {
  await shell({
    cmd: ["git", "worktree", "remove", "--force", dir],
    cwd: repoRoot,
    timeoutMs: 120_000,
  })
  rmSync(dir, { recursive: true, force: true })
}

// --- agent -----------------------------------------------------------------

interface AgentOutcome {
  readonly costUsd: number
  readonly turns: number
  readonly durationMs: number
  readonly error: string | null
  readonly raw: string
}

const digNumber = (input: { readonly value: unknown; readonly key: string }): number => {
  if (typeof input.value !== "object" || input.value === null) return 0
  const found = (input.value as Record<string, unknown>)[input.key]
  return typeof found === "number" ? found : 0
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const reportedError = (parsed: unknown): boolean =>
  typeof parsed === "object" &&
  parsed !== null &&
  (parsed as Record<string, unknown>).is_error === true

/**
 * `error_max_turns` is not the same failure as a bad answer — the agent was cut
 * off mid-repair, so its score understates the model. Keep the distinction in
 * the results instead of flattening both to "error".
 */
const errorSubtype = (parsed: unknown): string => {
  if (typeof parsed !== "object" || parsed === null) return "agent reported is_error"
  const subtype = (parsed as Record<string, unknown>).subtype
  return typeof subtype === "string" ? `agent stopped: ${subtype}` : "agent reported is_error"
}

/** Distinguish "the agent failed" from "the agent finished but did poor work". */
const agentErrorOf = (input: {
  readonly ran: Ran
  readonly parsed: unknown
  readonly timeoutMs: number
}): string | null => {
  if (input.ran.timedOut) return `timed out after ${input.timeoutMs}ms`
  if (input.ran.code !== 0) {
    return `claude exited ${input.ran.code}: ${input.ran.stderr.slice(0, 400)}`
  }
  return reportedError(input.parsed) ? errorSubtype(input.parsed) : null
}

const runAgent = async (input: {
  readonly prompt: string
  readonly model: string
  readonly cwd: string
  readonly options: Options
}): Promise<AgentOutcome> => {
  const ran = await shell({
    cmd: [
      "claude",
      "-p",
      input.prompt,
      "--model",
      input.model,
      "--permission-mode",
      input.options.permissionMode,
      "--max-turns",
      String(input.options.maxTurns),
      "--output-format",
      "json",
      "--setting-sources",
      "project",
    ],
    cwd: input.cwd,
    timeoutMs: input.options.timeoutMs,
  })
  const parsed = parseJson(ran.stdout)
  return {
    costUsd: digNumber({ value: parsed, key: "total_cost_usd" }),
    turns: digNumber({ value: parsed, key: "num_turns" }),
    durationMs: digNumber({ value: parsed, key: "duration_ms" }) || ran.ms,
    error: agentErrorOf({ ran, parsed, timeoutMs: input.options.timeoutMs }),
    raw: ran.stdout.length > 0 ? ran.stdout : ran.stderr,
  }
}

// --- one cell --------------------------------------------------------------

const firstNumber = (input: { readonly text: string; readonly pattern: RegExp }): number => {
  const match = input.text.match(input.pattern)
  const value = Number(match === null ? 0 : match[1])
  return Number.isFinite(value) ? value : 0
}

/** Churn is a rails proxy: a task done the canonical way touches few files. */
const churnOf = async (cwd: string): Promise<{ files: number; lines: number }> => {
  const stat = await sh({
    script:
      "git add -A -N >/dev/null 2>&1; git diff HEAD --numstat | wc -l; git diff HEAD --shortstat",
    cwd,
    timeoutMs: 60_000,
  })
  return {
    files: firstNumber({ text: stat.stdout, pattern: /(\d+)/ }),
    lines:
      firstNumber({ text: stat.stdout, pattern: /(\d+) insertions?\(\+\)/ }) +
      firstNumber({ text: stat.stdout, pattern: /(\d+) deletions?\(-\)/ }),
  }
}

const judge = async (input: {
  readonly task: Task
  readonly cwd: string
  readonly gateTimeoutMs: number
}): Promise<ReadonlyArray<CheckResult>> => {
  const results: CheckResult[] = []
  for (const gate of GATES) {
    const ran = await shell({
      cmd: ["bun", "run", gate],
      cwd: input.cwd,
      timeoutMs: input.gateTimeoutMs,
    })
    results.push({ name: gate, kind: "gate", ok: ran.code === 0, ms: ran.ms })
  }
  for (const assertion of input.task.asserts) {
    const ran = await sh({
      script: assertion.run,
      cwd: input.cwd,
      timeoutMs: input.gateTimeoutMs,
    })
    results.push({ name: assertion.name, kind: "assert", ok: ran.code === 0, ms: ran.ms })
  }
  return results
}

interface CellSpec {
  readonly task: Task
  readonly modelName: string
  readonly repeat: number
}

const NO_AGENT: AgentOutcome = { costUsd: 0, turns: 0, durationMs: 0, error: null, raw: "" }

const prepare = async (input: {
  readonly dir: string
  readonly key: string
  readonly options: Options
}): Promise<void> => {
  await addWorktree({ dir: input.dir, ref: input.options.ref, dirty: input.options.dirty })
  // Commit the starting state (including any --dirty overlay) so churn measures
  // the AGENT's diff, not the harness files we copied in behind it.
  await sh({
    script:
      'git add -A && git -c user.email=evals@local -c user.name=evals commit -q --allow-empty -m "eval baseline"',
    cwd: input.dir,
    timeoutMs: 120_000,
  })
  if (input.options.skipInstall) return
  const installed = await shell({
    cmd: ["bun", "install", "--frozen-lockfile"],
    cwd: input.dir,
    timeoutMs: 600_000,
  })
  if (installed.code !== 0) console.error(`  ! ${input.key}: bun install failed`)
}

const attempt = async (input: {
  readonly spec: CellSpec
  readonly dir: string
  readonly options: Options
}): Promise<AgentOutcome> =>
  input.options.baseline
    ? NO_AGENT
    : runAgent({
        prompt: input.spec.task.prompt,
        model: MODEL_IDS[input.spec.modelName] ?? input.spec.modelName,
        cwd: input.dir,
        options: input.options,
      })

const appendCell = async (input: {
  readonly logDir: string
  readonly cell: CellResult
}): Promise<void> => {
  const path = join(input.logDir, "cells.jsonl")
  const existing = await Bun.file(path)
    .text()
    .catch(() => "")
  await Bun.write(path, `${existing}${JSON.stringify(input.cell)}\n`)
}

const failedNames = (cell: CellResult): string =>
  cell.checks
    .filter((check) => !check.ok)
    .map((check) => check.name)
    .join(", ")

const logCell = (input: { readonly key: string; readonly cell: CellResult }): void => {
  const failed = failedNames(input.cell)
  console.error(
    `  ${isPass(input.cell.checks) ? "PASS" : "FAIL"} ${input.key}` +
      `  score=${scoreOf(input.cell.checks).toFixed(2)}` +
      ` cost=$${input.cell.costUsd.toFixed(3)} turns=${input.cell.turns}` +
      (failed === "" ? "" : `  failed: ${failed}`),
  )
}

const runCell = async (input: {
  readonly spec: CellSpec
  readonly options: Options
  readonly logDir: string
}): Promise<CellResult> => {
  const { task, modelName, repeat } = input.spec
  const key = `${task.id}--${modelName}--${repeat}`
  const dir = join(input.options.workRoot, key)
  const started = Bun.nanoseconds()
  await prepare({ dir, key, options: input.options })
  try {
    const agent = await attempt({ spec: input.spec, dir, options: input.options })
    if (agent.raw.length > 0) {
      await Bun.write(join(input.logDir, `${key}.json`), agent.raw)
    }
    const checks = await judge({ task, cwd: dir, gateTimeoutMs: input.options.gateTimeoutMs })
    const churn = await churnOf(dir)
    const cell: CellResult = {
      taskId: task.id,
      archetype: task.archetype,
      model: modelName,
      repeat,
      checks,
      costUsd: agent.costUsd,
      durationMs: agent.durationMs || (Bun.nanoseconds() - started) / 1e6,
      turns: agent.turns,
      filesChanged: churn.files,
      linesChanged: churn.lines,
      agentError: agent.error,
    }
    logCell({ key, cell })
    // Append-as-you-go: a long grid must survive a crash on cell 35 of 36.
    await appendCell({ logDir: input.logDir, cell })
    return cell
  } finally {
    // --keep-worktrees exists to post-mortem a failing cell. Sparing the cell
    // here and then wiping the work root at the end of the run — which is what
    // the ancestor of this file did — spares nothing: every cell is removed
    // moments after it was kept. So the flag is honoured in exactly one place,
    // and the run's final lines tell you how to clean up by hand.
    if (!input.options.keepWorktrees) await removeWorktree(dir).catch(() => undefined)
  }
}

// --- pool ------------------------------------------------------------------

const pooled = async (input: {
  readonly specs: ReadonlyArray<CellSpec>
  readonly limit: number
  readonly work: (spec: CellSpec) => Promise<CellResult>
}): Promise<ReadonlyArray<CellResult>> => {
  const results: CellResult[] = []
  const queue = [...input.specs]
  const workers = Array.from({ length: Math.max(1, input.limit) }, async () => {
    for (;;) {
      const next = queue.shift()
      if (next === undefined) return
      results.push(await input.work(next))
    }
  })
  await Promise.all(workers)
  return results
}

// --- main ------------------------------------------------------------------

interface Options {
  readonly ref: string
  readonly dirty: boolean
  readonly baseline: boolean
  readonly maxTurns: number
  readonly permissionMode: string
  readonly timeoutMs: number
  readonly gateTimeoutMs: number
  readonly keepWorktrees: boolean
  readonly skipInstall: boolean
  readonly workRoot: string
}

const tasksText = await Bun.file(join(import.meta.dir, "tasks.jsonl")).text()
const allTasks: ReadonlyArray<Task> = tasksText
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Task)

const suite = flag({ name: "suite", fallback: "smoke" })
const explicitIds = list(flag({ name: "tasks", fallback: "" }))
const tasks =
  explicitIds.length > 0
    ? allTasks.filter((task) => explicitIds.includes(task.id))
    : allTasks.filter((task) => task.suites.includes(suite))

if (tasks.length === 0) {
  console.error(`no tasks matched (suite=${suite}, tasks=${explicitIds.join(",") || "-"})`)
  process.exit(1)
}

const baseline = hasFlag("baseline")
const models = baseline ? ["none"] : list(flag({ name: "models", fallback: "sonnet" }))
const repeats = Math.max(1, numberFlag({ name: "repeats", fallback: 1 }))
const runId = flag({
  name: "run-id",
  fallback: `${new Date().toISOString().replace(/[:.]/g, "-")}${baseline ? "-baseline" : ""}`,
})

const options: Options = {
  ref: flag({ name: "ref", fallback: "HEAD" }),
  dirty: hasFlag("dirty"),
  baseline,
  maxTurns: numberFlag({ name: "max-turns", fallback: 100 }),
  permissionMode: flag({ name: "permission-mode", fallback: "bypassPermissions" }),
  timeoutMs: numberFlag({ name: "timeout-ms", fallback: 1_800_000 }),
  gateTimeoutMs: numberFlag({ name: "gate-timeout-ms", fallback: 900_000 }),
  keepWorktrees: hasFlag("keep-worktrees"),
  skipInstall: hasFlag("skip-install"),
  // Never under .claude/worktrees: that directory belongs to whoever is working
  // in this repo right now, and an eval cell is not their branch.
  workRoot: join(tmpdir(), "pid-evals", runId),
}

const outPath = flag({ name: "out", fallback: join(repoRoot, "evals", "results", `${runId}.json`) })
const logDir = join(repoRoot, "evals", "results", runId)
mkdirSync(options.workRoot, { recursive: true })
mkdirSync(logDir, { recursive: true })

const specs: ReadonlyArray<CellSpec> = tasks.flatMap((task) =>
  models.flatMap((modelName) =>
    Array.from({ length: repeats }, (_unused, repeat) => ({ task, modelName, repeat })),
  ),
)

console.error(
  `evals: ${specs.length} cells (${tasks.length} tasks × ${models.length} models × ${repeats})` +
    `${baseline ? " [BASELINE — no agent]" : ` models=${models.join(",")}`}` +
    ` ref=${options.ref}${options.dirty ? "+dirty" : ""} permission=${options.permissionMode}` +
    `\n  gates (derived from \`verify\`): ${GATES.join(", ")}`,
)

const startedAt = new Date().toISOString()
const cells = await pooled({
  specs,
  limit: numberFlag({ name: "concurrency", fallback: 2 }),
  work: (spec) => runCell({ spec, options, logDir }),
})

const payload = {
  runId,
  label: flag({ name: "label", fallback: "" }),
  startedAt,
  finishedAt: new Date().toISOString(),
  suite: explicitIds.length > 0 ? "explicit" : suite,
  models,
  repeats,
  baseline,
  ref: options.ref,
  dirty: options.dirty,
  permissionMode: options.permissionMode,
  maxTurns: options.maxTurns,
  gates: GATES,
  cells,
}
await Bun.write(outPath, `${JSON.stringify(payload, null, 2)}\n`)

const passes = cells.filter((cell) => isPass(cell.checks)).length
const meanScore = cells.reduce((sum, cell) => sum + scoreOf(cell.checks), 0) / (cells.length || 1)
const totalCost = cells.reduce((sum, cell) => sum + cell.costUsd, 0)
console.error(
  `\nevals: ${passes}/${cells.length} cells fully green, mean score ${meanScore.toFixed(
    3,
  )}, spend $${totalCost.toFixed(2)}\n  -> ${outPath}\n  report: bun run evals:report ${outPath}`,
)
if (baseline) {
  console.error(
    `  a do-nothing agent scores ${NO_OP_SCORE.toFixed(3)} on a well-formed task` +
      ` (every gate green, every assert red); anything higher above is a task measuring nothing`,
  )
}

if (options.keepWorktrees) {
  console.error(`  worktrees kept: ${options.workRoot}`)
  console.error(`  clean up with: git worktree remove --force ${options.workRoot}/<cell>`)
} else {
  rmSync(options.workRoot, { recursive: true, force: true })
}
// A red eval run is a signal, not a build break: exit 0 unless asked otherwise.
if (hasFlag("fail-on-red") && passes < cells.length) process.exit(1)
