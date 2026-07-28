// Pure decoders for the fleet wire shapes (apps/daemon/src/features/fleet). A
// cast would assert the shape without checking it — contracts decode at the
// boundary (CLAUDE.md) — so every hook hands its response's decoded `unknown`
// here instead of casting `.json()` directly. Mirrors
// features/sessions/sessionPeek.ts's parsePeekSummary.

import type {
  FleetErrorWire,
  FleetStepWire,
  FleetsResponse,
  FleetWire,
  RunAttemptResult,
  RunPlanWire,
  RunStatus,
  RunSummaryWire,
  ShortOutcomeWire,
  StepStatus,
  StepSummaryWire,
  WaitOutcomeWire,
} from "./types"

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string")

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

const parseStep = (raw: unknown): FleetStepWire | undefined => {
  if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.intent !== "string") {
    return undefined
  }
  return {
    id: raw.id,
    intent: raw.intent,
    n: typeof raw.n === "number" ? raw.n : 1,
    agent: str(raw.agent),
    cwd: str(raw.cwd),
    needs: isStringArray(raw.needs) ? raw.needs : [],
    until: isStringArray(raw.until) ? raw.until : undefined,
    timeoutMs: num(raw.timeoutMs),
  }
}

const parseSteps = (raw: unknown): FleetStepWire[] =>
  Array.isArray(raw) ? raw.map(parseStep).filter((s): s is FleetStepWire => s !== undefined) : []

const parseWaves = (raw: unknown): string[][] =>
  Array.isArray(raw) ? raw.map((wave) => (isStringArray(wave) ? wave : [])) : []

const parseWaveGroups = (raw: unknown): FleetStepWire[][] =>
  Array.isArray(raw) ? raw.map(parseSteps) : []

const parseFleet = (raw: unknown): FleetWire | undefined => {
  if (!isObject(raw) || typeof raw.name !== "string") return undefined
  return {
    name: raw.name,
    description: str(raw.description),
    steps: parseSteps(raw.steps),
    waves: parseWaves(raw.waves),
  }
}

const parseFleetError = (raw: unknown): FleetErrorWire | undefined => {
  if (!isObject(raw) || typeof raw.fleet !== "string" || typeof raw.message !== "string") {
    return undefined
  }
  return { fleet: raw.fleet, step: str(raw.step), message: raw.message }
}

const parseFleetErrors = (raw: unknown): FleetErrorWire[] =>
  Array.isArray(raw)
    ? raw.map(parseFleetError).filter((e): e is FleetErrorWire => e !== undefined)
    : []

const parseFleets = (raw: unknown): FleetWire[] =>
  Array.isArray(raw) ? raw.map(parseFleet).filter((f): f is FleetWire => f !== undefined) : []

// GET /projects/:id/fleets — an unrecognisable body degrades to "no fleets,
// no errors" rather than throwing, the same forgiving default the daemon's own
// readFleetFile applies to a missing fleet.json.
export const parseFleetsResponse = (raw: unknown): FleetsResponse => ({
  fleets: isObject(raw) ? parseFleets(raw.fleets) : [],
  errors: isObject(raw) ? parseFleetErrors(raw.errors) : [],
})

const parseRunPlan = (raw: unknown): RunPlanWire | undefined => {
  if (!isObject(raw) || typeof raw.fleet !== "string") return undefined
  return {
    fleet: raw.fleet,
    waves: parseWaveGroups(raw.waves),
    totalSessions: num(raw.totalSessions) ?? 0,
    maxConcurrentSpawns: num(raw.maxConcurrentSpawns) ?? 0,
  }
}

// Each of these decodes exactly one status/shape combination and returns
// `undefined` on a mismatch — kept as one-shape-per-function (rather than one
// long if-chain) so parseRunAttempt's own branching stays a flat dispatch
// instead of compounding every shape check into one function's complexity.

const parseDryRunResult = (body: unknown): RunAttemptResult | undefined => {
  if (!isObject(body) || body.dryRun !== true) return undefined
  const plan = parseRunPlan(body.plan)
  return plan ? { _tag: "DryRun", plan } : undefined
}

const parseStartedResult = (body: unknown): RunAttemptResult | undefined => {
  if (!isObject(body) || typeof body.runId !== "string") return undefined
  return {
    _tag: "Started",
    runId: body.runId,
    waves: parseWaveGroups(body.waves),
    totalSessions: num(body.totalSessions) ?? 0,
  }
}

const parseAlreadyActiveResult = (body: unknown): RunAttemptResult | undefined => {
  if (!isObject(body) || typeof body.runId !== "string") return undefined
  return { _tag: "AlreadyActive", runId: body.runId }
}

const parseCapExceededResult = (body: unknown): RunAttemptResult | undefined => {
  if (!isObject(body) || body.error !== "cap_exceeded" || !isObject(body.violation))
    return undefined
  return {
    _tag: "CapExceeded",
    requested: num(body.violation.requested) ?? 0,
    max: num(body.violation.max) ?? 0,
  }
}

const parseInvalidRecipeResult = (body: unknown): RunAttemptResult | undefined =>
  isObject(body) && body.error === "invalid_recipe"
    ? { _tag: "InvalidRecipe", errors: parseFleetErrors(body.errors) }
    : undefined

const parseInvalidBodyResult = (body: unknown): RunAttemptResult | undefined =>
  isObject(body) && body.error === "invalid_body"
    ? { _tag: "InvalidBody", message: str(body.message) ?? "invalid request body" }
    : undefined

// One parser per HTTP status the daemon can answer a 200/202/409 with —
// mirrors fleet-run.core.ts's own EVENT_HANDLERS table-dispatch precedent for
// keeping a discriminator's own function flat.
const RESULT_PARSERS_BY_STATUS: Readonly<
  Record<number, (body: unknown) => RunAttemptResult | undefined>
> = {
  200: parseDryRunResult,
  202: parseStartedResult,
  409: parseAlreadyActiveResult,
}

// A 400 can mean three different problems; try each shape in turn.
const BAD_REQUEST_PARSERS: ReadonlyArray<(body: unknown) => RunAttemptResult | undefined> = [
  parseCapExceededResult,
  parseInvalidRecipeResult,
  parseInvalidBodyResult,
]

// POST /projects/:id/fleets/:name/run answers with a different body shape per
// HTTP status; folding {status, body} into one discriminated union lets a
// caller switch on `_tag` instead of re-deriving meaning from a status code at
// every call site.
export const parseRunAttempt = ({
  status,
  body,
}: {
  readonly status: number
  readonly body: unknown
}): RunAttemptResult => {
  if (status === 404) return { _tag: "NotFound" }
  if (status === 400) {
    const result = BAD_REQUEST_PARSERS.reduce<RunAttemptResult | undefined>(
      (found, parse) => found ?? parse(body),
      undefined,
    )
    return result ?? { _tag: "UnknownError", status }
  }
  return RESULT_PARSERS_BY_STATUS[status]?.(body) ?? { _tag: "UnknownError", status }
}

const WAIT_TAGS = ["Satisfied", "Timeout", "OccupantChanged", "Removed", "NotFound"] as const

const parseWaitOutcome = (raw: unknown): WaitOutcomeWire | undefined => {
  if (!isObject(raw) || typeof raw._tag !== "string") return undefined
  const tag = raw._tag
  if (!(WAIT_TAGS as readonly string[]).includes(tag)) return undefined
  if (tag === "Satisfied") {
    return typeof raw.state === "string" && typeof raw.waitedMs === "number"
      ? { _tag: "Satisfied", state: raw.state, waitedMs: raw.waitedMs }
      : undefined
  }
  if (tag === "Timeout") {
    return typeof raw.waitedMs === "number"
      ? { _tag: "Timeout", waitedMs: raw.waitedMs }
      : undefined
  }
  return { _tag: tag as "OccupantChanged" | "Removed" | "NotFound" }
}

const parseShortOutcome = (raw: unknown): ShortOutcomeWire | undefined => {
  if (!isObject(raw) || typeof raw.short !== "string") return undefined
  return { short: raw.short, wait: parseWaitOutcome(raw.wait) }
}

const parseShorts = (raw: unknown): ShortOutcomeWire[] =>
  Array.isArray(raw)
    ? raw.map(parseShortOutcome).filter((s): s is ShortOutcomeWire => s !== undefined)
    : []

const STEP_STATUSES: readonly StepStatus[] = [
  "pending",
  "spawning",
  "waiting",
  "done",
  "failed",
  "skipped",
]
const isStepStatus = (v: unknown): v is StepStatus =>
  typeof v === "string" && (STEP_STATUSES as readonly string[]).includes(v)

const parseStepSummary = (raw: unknown): StepSummaryWire | undefined => {
  if (!isObject(raw) || typeof raw.stepId !== "string" || !isStepStatus(raw.status)) {
    return undefined
  }
  return {
    stepId: raw.stepId,
    waveIndex: num(raw.waveIndex) ?? 0,
    intent: str(raw.intent) ?? "",
    n: num(raw.n) ?? 1,
    status: raw.status,
    shorts: parseShorts(raw.shorts),
    reason: str(raw.reason),
  }
}

const RUN_STATUSES: readonly RunStatus[] = ["running", "done", "failed"]
const isRunStatus = (v: unknown): v is RunStatus =>
  typeof v === "string" && (RUN_STATUSES as readonly string[]).includes(v)

// One run, as returned by GET /projects/:id/fleet-runs/:runId and by every
// entry of GET /projects/:id/fleet-runs — also used to decode the `fleet.run`
// SSE payload (lib/sse.ts), so the daemon's push and pull paths share one
// parser.
export const parseRunSummary = (raw: unknown): RunSummaryWire | undefined => {
  if (
    !isObject(raw) ||
    typeof raw.id !== "string" ||
    typeof raw.projectId !== "string" ||
    typeof raw.fleet !== "string" ||
    !isRunStatus(raw.status)
  ) {
    return undefined
  }
  return {
    id: raw.id,
    projectId: raw.projectId,
    fleet: raw.fleet,
    status: raw.status,
    totalSessions: num(raw.totalSessions) ?? 0,
    startedAt: num(raw.startedAt) ?? 0,
    finishedAt: num(raw.finishedAt),
    steps: Array.isArray(raw.steps)
      ? raw.steps.map(parseStepSummary).filter((s): s is StepSummaryWire => s !== undefined)
      : [],
  }
}

export const parseFleetRunsResponse = (raw: unknown): readonly RunSummaryWire[] =>
  isObject(raw) && Array.isArray(raw.runs)
    ? raw.runs.map(parseRunSummary).filter((r): r is RunSummaryWire => r !== undefined)
    : []
