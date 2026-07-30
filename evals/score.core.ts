/**
 * Eval scoring — PURE (data in / data out; no clock, no I/O, no Effect).
 *
 * `evals/run.ts` is the imperative shell: it drives worktrees, spawns headless
 * agents and shells out to the gates. Everything it then *concludes* from those
 * observations lives here, so the interesting half of the harness is
 * unit-testable without spending a token. The eval harness is held to the same
 * impureim sandwich it scores other code against.
 *
 * Two ideas do the work.
 *
 * 1. **Graded, and the grade cannot be gamed by doing nothing.** A cell
 *    (task × model × repeat) is judged by two juries: the repo's own gates
 *    (`lint:ci` / `typecheck` / `test` / `test:web` / `test:cli` / `audit` /
 *    `axiom-debt`) prove the agent did not break the repo, and the task's own
 *    asserts prove it actually built the thing. The asserts are worth **twice**
 *    the gates *as a group*, because `bun run verify` is already green on an
 *    untouched checkout — a gates-only eval scores a do-nothing agent 100%.
 *
 *    Weighting per *check* (the obvious design) does not hold that ratio: a
 *    task with two asserts and seven gates would score a do-nothing agent
 *    7/(7+4) = 0.64, and adding a gate to the repo would silently raise every
 *    task's floor. So the shares are per *jury*: whatever the counts,
 *    `NO_OP_SCORE` (1/3) is the ceiling for an agent that changed nothing, and
 *    it stays 1/3 when someone adds a gate or an assert.
 *
 * 2. **A delta is only real if it clears the noise.** Agents are stochastic, so
 *    `verdictOf` compares two samples against the standard error of their
 *    difference (2σ by default) and refuses to call anything at n=1 unless the
 *    gap is blunt.
 */

export type CheckKind = "gate" | "assert"

export interface CheckResult {
  readonly name: string
  readonly kind: CheckKind
  readonly ok: boolean
  readonly ms: number
}

/** One task × model × repeat, after the agent ran and both juries judged it. */
export interface CellResult {
  readonly taskId: string
  readonly archetype: string
  readonly model: string
  readonly repeat: number
  readonly checks: ReadonlyArray<CheckResult>
  readonly costUsd: number
  readonly durationMs: number
  readonly turns: number
  readonly filesChanged: number
  readonly linesChanged: number
  readonly agentError: string | null
}

/**
 * Share of the final score each jury carries — asserts outweigh gates 2:1.
 * A *share*, not a per-check weight: see the header for why that distinction
 * is what keeps the do-nothing floor pinned at 1/3.
 */
const SHARE_BY_KIND: Readonly<Record<CheckKind, number>> = { gate: 1, assert: 2 }

const KINDS: ReadonlyArray<CheckKind> = ["gate", "assert"]

/** Fraction of one jury's checks that passed, or null when it did not sit. */
export const passFractionOf = (input: {
  readonly checks: ReadonlyArray<CheckResult>
  readonly kind: CheckKind
}): number | null => {
  const own = input.checks.filter((check) => check.kind === input.kind)
  if (own.length === 0) return null
  return own.filter((check) => check.ok).length / own.length
}

/**
 * Weighted fraction of the two juries that passed, in [0, 1]. A jury with no
 * checks does not sit, and its share is redistributed — otherwise a task with
 * no asserts would cap at 1/3 rather than being rejected outright, which is
 * `bun run doctor`'s job (a task with no asserts is free points and fails the
 * harness self-check).
 */
export const scoreOf = (checks: ReadonlyArray<CheckResult>): number => {
  const sitting = KINDS.map((kind) => ({
    share: SHARE_BY_KIND[kind],
    fraction: passFractionOf({ checks, kind }),
  })).filter((jury): jury is { share: number; fraction: number } => jury.fraction !== null)
  const totalShare = sitting.reduce((sum, jury) => sum + jury.share, 0)
  if (totalShare === 0) return 0
  return sitting.reduce((sum, jury) => sum + jury.share * jury.fraction, 0) / totalShare
}

/**
 * What an agent that changes nothing scores on a well-formed task: every gate
 * green (the repo was already green), every assert red. Published so the report
 * and the README can state the floor rather than re-deriving it, and so the
 * baseline run has something to be compared against.
 */
export const NO_OP_SCORE: number = SHARE_BY_KIND.gate / (SHARE_BY_KIND.gate + SHARE_BY_KIND.assert)

/** A cell "passes" only when every check is green — no partial credit here. */
export const isPass = (checks: ReadonlyArray<CheckResult>): boolean =>
  checks.length > 0 && checks.every((check) => check.ok)

export const mean = (xs: ReadonlyArray<number>): number =>
  xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length

/** Sample standard deviation (n-1). Fewer than two samples -> 0. */
export const stdev = (xs: ReadonlyArray<number>): number => {
  if (xs.length < 2) return 0
  const mu = mean(xs)
  const variance = xs.reduce((sum, x) => sum + (x - mu) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

export interface ModelSummary {
  readonly model: string
  readonly cells: number
  readonly passRate: number
  readonly meanScore: number
  readonly scoreStdev: number
  readonly totalCostUsd: number
  readonly meanCostUsd: number
  readonly meanDurationMs: number
  readonly meanTurns: number
  readonly meanFilesChanged: number
  readonly agentErrors: number
}

const distinct = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)]

const summariseCells = (input: {
  readonly model: string
  readonly cells: ReadonlyArray<CellResult>
}): ModelSummary => {
  const scores = input.cells.map((cell) => scoreOf(cell.checks))
  const costs = input.cells.map((cell) => cell.costUsd)
  return {
    model: input.model,
    cells: input.cells.length,
    passRate: mean(input.cells.map((cell) => (isPass(cell.checks) ? 1 : 0))),
    meanScore: mean(scores),
    scoreStdev: stdev(scores),
    totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    meanDurationMs: mean(input.cells.map((cell) => cell.durationMs)),
    meanTurns: mean(input.cells.map((cell) => cell.turns)),
    meanFilesChanged: mean(input.cells.map((cell) => cell.filesChanged)),
    agentErrors: input.cells.filter((cell) => cell.agentError !== null).length,
  }
}

/** One row per model, ordered as first seen in the results. */
export const summariseByModel = (cells: ReadonlyArray<CellResult>): ReadonlyArray<ModelSummary> =>
  distinct(cells.map((cell) => cell.model)).map((model) =>
    summariseCells({ model, cells: cells.filter((cell) => cell.model === model) }),
  )

export interface TaskModelCell {
  readonly taskId: string
  readonly archetype: string
  readonly model: string
  readonly meanScore: number
  readonly passRate: number
  readonly runs: number
  readonly failedChecks: ReadonlyArray<string>
}

/** The task × model matrix: where exactly a cheaper model starts to break. */
export const summariseByTask = (cells: ReadonlyArray<CellResult>): ReadonlyArray<TaskModelCell> =>
  distinct(cells.map((cell) => cell.taskId)).flatMap((taskId) => {
    const forTask = cells.filter((cell) => cell.taskId === taskId)
    return distinct(forTask.map((cell) => cell.model)).map((model) => {
      const runs = forTask.filter((cell) => cell.model === model)
      const failed = runs.flatMap((run) =>
        run.checks.filter((check) => !check.ok).map((check) => check.name),
      )
      return {
        taskId,
        archetype: runs.reduce((acc, run) => run.archetype ?? acc, ""),
        model,
        meanScore: mean(runs.map((run) => scoreOf(run.checks))),
        passRate: mean(runs.map((run) => (isPass(run.checks) ? 1 : 0))),
        runs: runs.length,
        failedChecks: distinct(failed),
      }
    })
  })

export type VerdictLabel = "improved" | "regressed" | "noise"

export interface Verdict {
  readonly delta: number
  readonly threshold: number
  readonly label: VerdictLabel
}

/**
 * Is `candidate` really better than `base`, or did the dice land differently?
 *
 * Threshold = sigma × the standard error of the difference of means. With fewer
 * than two samples on either side there is no variance estimate at all, so the
 * call falls back to a blunt minimum delta — the canon's "judge over several
 * runs against a noise floor, not a single number", made executable.
 */
const standardErrorOfDifference = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
}): number =>
  Math.sqrt(
    stdev(input.base) ** 2 / Math.max(1, input.base.length) +
      stdev(input.candidate) ** 2 / Math.max(1, input.candidate.length),
  )

const labelOf = (input: { readonly delta: number; readonly threshold: number }): VerdictLabel => {
  if (input.delta > input.threshold) return "improved"
  return input.delta < -input.threshold ? "regressed" : "noise"
}

const DEFAULT_SIGMA = 2
/** With n<2 there is no variance to measure, so demand a blunt visible gap. */
const DEFAULT_MIN_DELTA = 0.1

const canEstimateNoise = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
}): boolean => input.base.length > 1 && input.candidate.length > 1

const thresholdOf = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
  readonly sigma?: number
  readonly minDelta?: number
}): number =>
  canEstimateNoise(input)
    ? Math.max((input.sigma ?? DEFAULT_SIGMA) * standardErrorOfDifference(input), 1e-9)
    : (input.minDelta ?? DEFAULT_MIN_DELTA)

export const verdictOf = (input: {
  readonly base: ReadonlyArray<number>
  readonly candidate: ReadonlyArray<number>
  readonly sigma?: number
  readonly minDelta?: number
}): Verdict => {
  const delta = mean(input.candidate) - mean(input.base)
  const threshold = thresholdOf(input)
  return { delta, threshold, label: labelOf({ delta, threshold }) }
}

export interface TrivialTask {
  readonly taskId: string
  readonly noOpScore: number
  /** Fraction of this task's asserts that pass with NO agent. Must be 0. */
  readonly noOpAssertPassRate: number
}

/**
 * Tasks a do-nothing agent already scores on — i.e. tasks that measure nothing.
 * Feed this the `--baseline` run (both juries over an untouched worktree, no
 * agent).
 *
 * The sharp signal is `noOpAssertPassRate`: an assert that is green before the
 * agent starts is not evidence, it is decoration. A regression guard ("/health
 * stays public") therefore has to be *chained* onto the positive proof inside a
 * single assert rather than shipped as its own, or it hands out free points
 * forever. The score threshold is kept as a second, blunter net.
 */
export const trivialTasks = (input: {
  readonly baseline: ReadonlyArray<CellResult>
  readonly threshold?: number
}): ReadonlyArray<TrivialTask> => {
  const threshold = input.threshold ?? NO_OP_SCORE + 0.01
  return distinct(input.baseline.map((cell) => cell.taskId))
    .map((taskId) => {
      const forTask = input.baseline.filter((cell) => cell.taskId === taskId)
      return {
        taskId,
        noOpScore: mean(forTask.map((cell) => scoreOf(cell.checks))),
        noOpAssertPassRate: mean(
          forTask.map((cell) => passFractionOf({ checks: cell.checks, kind: "assert" }) ?? 0),
        ),
      }
    })
    .filter((task) => task.noOpAssertPassRate > 0 || task.noOpScore > threshold)
}

/**
 * Cost of one point of score — the number that answers "is the cheap model
 * actually cheaper?". A model that is 10× cheaper but scores 0 is infinitely
 * expensive per point, and this makes that visible.
 */
export const costPerPoint = (summary: ModelSummary): number =>
  summary.meanScore === 0 ? Number.POSITIVE_INFINITY : summary.meanCostUsd / summary.meanScore
