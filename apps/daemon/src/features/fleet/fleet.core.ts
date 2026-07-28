// Pure schema, validation and dependency-wave planning for declarative fleet
// recipes (<project>/.pid/fleet.json). No I/O — reading the file off disk
// lives in fleet.io.ts.
//
// A fleet recipe describes a re-runnable multi-agent run: N steps, each
// spawning `n` agents with a shared `intent`, plus `needs` dependencies
// between steps. THIS FILE IS SCHEMA + VALIDATION + PLANNING ONLY — there is
// no runner yet. See AGENTS.md "Fleet recipes" for what the follow-up PR adds.

import { Either } from "effect"

// --- Mirrored vocabulary -----------------------------------------------------
//
// Mirrors `KNOWN_STATES` (apps/daemon/src/features/sessions/sessions.core.ts)
// and `WAIT_TIMEOUT_MAX_MS` (apps/daemon/src/features/sessions/sessions-wait.core.ts)
// as LITERAL copies rather than imports: this file lives in `features/fleet/`,
// and `bun run axiom-debt`'s cross-slice-import counter fails the build on any
// NEW violation of "a slice may only import another slice's *published* door,
// never its internals" — sessions.core/sessions-wait.core are internals, not a
// door. `apps/cli/src/agent/agent.core.ts` hits the identical constraint from
// outside the daemon package entirely (the daemon's package.json `exports`
// only publishes ".", "./server" and "./types") and keeps the same kind of
// literal copy — see that file's own comment for the precedent. Kept honest by
// scripts/mirrored-constants.test.ts, which imports the real values and
// asserts these copies still match.
export const SESSION_STATE_SLUGS = [
  "done",
  "working",
  "blocked",
  "needs_input",
  "idle",
  "failed",
  "stopped",
  "unknown",
] as const
export type SessionStateSlug = (typeof SESSION_STATE_SLUGS)[number]

const isSessionStateSlug = (s: string): s is SessionStateSlug =>
  (SESSION_STATE_SLUGS as readonly string[]).includes(s)

export const WAIT_TIMEOUT_MAX_MS = 600_000

// A single step can spawn at most this many agents (`n`). Spawning costs the
// user's own API quota, so an unbounded `n` would let one bad recipe — or a
// simple typo, `n: 500` instead of `n: 5` — burn it silently. 20 is
// comfortably above any realistic fan-out this repo's own dogfood recipes use
// (a handful of reviewers, a handful of test shards) while still catching an
// order-of-magnitude mistake before anything would run.
export const MAX_STEP_N = 20

// --- Schema -------------------------------------------------------------------

export type StepId = string

export type FleetStep = {
  readonly id: StepId
  readonly intent: string
  readonly n: number
  readonly agent: string | undefined
  readonly cwd: string | undefined
  readonly needs: ReadonlyArray<StepId>
  readonly until: ReadonlyArray<SessionStateSlug> | undefined
  readonly timeoutMs: number | undefined
}

export type Fleet = {
  readonly name: string
  readonly description: string | undefined
  readonly steps: ReadonlyArray<FleetStep>
}

export type FleetFile = {
  readonly fleets: ReadonlyArray<Fleet>
}

export type FleetError = {
  readonly fleet: string
  // undefined for a fleet-scoped problem (bad name, a cycle spanning several
  // steps); the step's id (or a "step #N" placeholder when the id itself
  // couldn't be read) for a step-scoped one.
  readonly step: StepId | undefined
  readonly message: string
}

const fleetErr = ({
  fleet,
  step,
  message,
}: {
  readonly fleet: string
  readonly step: StepId | undefined
  readonly message: string
}): FleetError => ({ fleet, step, message })

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0

// --- Labeling (used to attribute an error before a name/id is known valid) --

const fleetLabelFor = ({
  raw,
  index,
}: {
  readonly raw: unknown
  readonly index: number
}): string => (isPlainObject(raw) && isNonEmptyString(raw.name) ? raw.name : `fleet #${index + 1}`)

const stepLabelFor = ({ raw, index }: { readonly raw: unknown; readonly index: number }): string =>
  isPlainObject(raw) && isNonEmptyString(raw.id) ? raw.id : `step #${index + 1}`

// --- Per-step field validation ------------------------------------------------
//
// Each validator below checks exactly one field and returns zero or one
// errors; validateStepFields concatenates them so every problem on a step is
// reported at once, not just the first one hit.

type StepCtx = {
  readonly raw: Record<string, unknown>
  readonly fleet: string
  readonly label: string
}

const validateStepId = ({ raw, fleet, label }: StepCtx): readonly FleetError[] =>
  isNonEmptyString(raw.id)
    ? []
    : [fleetErr({ fleet, step: label, message: "id must be a non-empty string" })]

const validateStepIntent = ({ raw, fleet, label }: StepCtx): readonly FleetError[] =>
  isNonEmptyString(raw.intent)
    ? []
    : [fleetErr({ fleet, step: label, message: "intent must be a non-empty string" })]

const validateStepN = ({ raw, fleet, label }: StepCtx): readonly FleetError[] => {
  if (raw.n === undefined) return []
  const n = raw.n
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_STEP_N
    ? []
    : [
        fleetErr({
          fleet,
          step: label,
          message: `n must be an integer between 1 and ${MAX_STEP_N}`,
        }),
      ]
}

const validateOptionalString = ({
  raw,
  fleet,
  label,
  key,
}: StepCtx & { readonly key: "agent" | "cwd" }): readonly FleetError[] => {
  const value = raw[key]
  if (value === undefined) return []
  return isNonEmptyString(value)
    ? []
    : [fleetErr({ fleet, step: label, message: `${key} must be a non-empty string` })]
}

const validateStepNeeds = ({ raw, fleet, label }: StepCtx): readonly FleetError[] => {
  if (raw.needs === undefined) return []
  const ok = Array.isArray(raw.needs) && raw.needs.every(isNonEmptyString)
  return ok
    ? []
    : [fleetErr({ fleet, step: label, message: "needs must be an array of non-empty step ids" })]
}

const validateStepUntil = ({ raw, fleet, label }: StepCtx): readonly FleetError[] => {
  if (raw.until === undefined) return []
  if (!Array.isArray(raw.until) || raw.until.length === 0) {
    return [
      fleetErr({
        fleet,
        step: label,
        message: "until must be a non-empty array of session states",
      }),
    ]
  }
  const bad = raw.until.find((u) => typeof u !== "string" || !isSessionStateSlug(u))
  return bad === undefined
    ? []
    : [
        fleetErr({
          fleet,
          step: label,
          message: `until contains an unknown state: ${JSON.stringify(bad)}`,
        }),
      ]
}

const validateStepTimeoutMs = ({ raw, fleet, label }: StepCtx): readonly FleetError[] => {
  if (raw.timeoutMs === undefined) return []
  const t = raw.timeoutMs
  if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > WAIT_TIMEOUT_MAX_MS) {
    return [
      fleetErr({
        fleet,
        step: label,
        message: `timeoutMs must be an integer between 1 and ${WAIT_TIMEOUT_MAX_MS}`,
      }),
    ]
  }
  return raw.until === undefined
    ? [fleetErr({ fleet, step: label, message: "timeoutMs requires until to be set" })]
    : []
}

const validateStepFields = (ctx: StepCtx): readonly FleetError[] => [
  ...validateStepId(ctx),
  ...validateStepIntent(ctx),
  ...validateStepN(ctx),
  ...validateOptionalString({ ...ctx, key: "agent" }),
  ...validateOptionalString({ ...ctx, key: "cwd" }),
  ...validateStepNeeds(ctx),
  ...validateStepUntil(ctx),
  ...validateStepTimeoutMs(ctx),
]

// Reads a step's fields straight off the validated raw object. Safe only
// because validateStepFields (called first, by every caller below) already
// confirmed every field's shape — this function never runs otherwise.
const buildStep = (raw: Record<string, unknown>): FleetStep => ({
  id: raw.id as string,
  intent: raw.intent as string,
  n: (raw.n as number | undefined) ?? 1,
  agent: raw.agent as string | undefined,
  cwd: raw.cwd as string | undefined,
  needs: (raw.needs as readonly string[] | undefined) ?? [],
  until: raw.until as readonly SessionStateSlug[] | undefined,
  timeoutMs: raw.timeoutMs as number | undefined,
})

// --- Fleet-wide structural checks (need every step's id up front) -----------

const findDuplicateStepIds = ({
  steps,
  fleet,
}: {
  readonly steps: readonly FleetStep[]
  readonly fleet: string
}): readonly FleetError[] => {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const s of steps) {
    if (seen.has(s.id)) dupes.add(s.id)
    seen.add(s.id)
  }
  return [...dupes]
    .sort()
    .map((id) => fleetErr({ fleet, step: id, message: `duplicate step id: "${id}"` }))
}

const findUnknownNeeds = ({
  steps,
  fleet,
}: {
  readonly steps: readonly FleetStep[]
  readonly fleet: string
}): readonly FleetError[] => {
  const ids = new Set(steps.map((s) => s.id))
  const errors: FleetError[] = []
  for (const s of steps) {
    for (const need of s.needs) {
      if (!ids.has(need)) {
        errors.push(fleetErr({ fleet, step: s.id, message: `needs unknown step: "${need}"` }))
      }
    }
  }
  return errors
}

// Kahn's algorithm: repeatedly peel off every step whose `needs` are all
// already resolved into a "wave"; steps within a wave can run concurrently.
// A Left is every step id that never became ready — exactly the set involved
// in (or downstream of) a cycle, since `needs` existence is guaranteed by the
// caller (findUnknownNeeds runs first). Each wave is sorted for a
// deterministic, testable order.
const computeWaves = (
  steps: readonly FleetStep[],
): Either.Either<ReadonlyArray<ReadonlyArray<StepId>>, ReadonlyArray<StepId>> => {
  const byId = new Map(steps.map((s) => [s.id, s] as const))
  const remaining = new Set(byId.keys())
  const waves: StepId[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => (byId.get(id)?.needs ?? []).every((need) => !remaining.has(need)))
      .sort()
    if (ready.length === 0) return Either.left([...remaining].sort())
    for (const id of ready) remaining.delete(id)
    waves.push(ready)
  }
  return Either.right(waves)
}

// Same wave computation, exposed for the routes layer (and directly tested
// here on hand-built Fleet values): a cycle becomes a single FleetError
// naming every step still blocked.
export const planFleetRun = ({
  fleet,
}: {
  readonly fleet: Fleet
}): Either.Either<ReadonlyArray<ReadonlyArray<StepId>>, FleetError> => {
  const result = computeWaves(fleet.steps)
  if (Either.isLeft(result)) {
    return Either.left(
      fleetErr({
        fleet: fleet.name,
        step: undefined,
        message: `dependency cycle detected among steps: ${result.left.join(", ")}`,
      }),
    )
  }
  return Either.right(result.right)
}

// --- Steps array -------------------------------------------------------------

type StepsParse = {
  readonly steps: readonly FleetStep[] | undefined
  readonly errors: readonly FleetError[]
}

const parseStepsArray = ({
  raw,
  fleet,
}: {
  readonly raw: unknown
  readonly fleet: string
}): StepsParse => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      steps: undefined,
      errors: [fleetErr({ fleet, step: undefined, message: "steps must be a non-empty array" })],
    }
  }
  const fieldErrors: FleetError[] = []
  const steps: FleetStep[] = []
  raw.forEach((rawStep, index) => {
    const label = stepLabelFor({ raw: rawStep, index })
    if (!isPlainObject(rawStep)) {
      fieldErrors.push(fleetErr({ fleet, step: label, message: "step must be an object" }))
      return
    }
    const errs = validateStepFields({ raw: rawStep, fleet, label })
    if (errs.length > 0) {
      fieldErrors.push(...errs)
      return
    }
    steps.push(buildStep(rawStep))
  })
  if (fieldErrors.length > 0) return { steps: undefined, errors: fieldErrors }

  const structuralErrors = [
    ...findDuplicateStepIds({ steps, fleet }),
    ...findUnknownNeeds({ steps, fleet }),
  ]
  if (structuralErrors.length > 0) return { steps: undefined, errors: structuralErrors }

  const cyclic = computeWaves(steps)
  if (Either.isLeft(cyclic)) {
    return {
      steps: undefined,
      errors: [
        fleetErr({
          fleet,
          step: undefined,
          message: `dependency cycle detected among steps: ${cyclic.left.join(", ")}`,
        }),
      ],
    }
  }
  return { steps, errors: [] }
}

// --- One fleet entry -----------------------------------------------------------

type FleetParse = {
  readonly name: string | undefined
  readonly fleet: Fleet | undefined
  readonly errors: readonly FleetError[]
}

const parseOneFleet = ({
  raw,
  index,
}: {
  readonly raw: unknown
  readonly index: number
}): FleetParse => {
  const label = fleetLabelFor({ raw, index })
  if (!isPlainObject(raw)) {
    return {
      name: undefined,
      fleet: undefined,
      errors: [fleetErr({ fleet: label, step: undefined, message: "fleet must be an object" })],
    }
  }
  const name = isNonEmptyString(raw.name) ? raw.name : undefined
  const nameErrors =
    name === undefined
      ? [
          fleetErr({
            fleet: label,
            step: undefined,
            message: "fleet name must be a non-empty string",
          }),
        ]
      : []
  const stepsResult = parseStepsArray({ raw: raw.steps, fleet: label })
  const errors = [...nameErrors, ...stepsResult.errors]
  if (errors.length > 0 || name === undefined || stepsResult.steps === undefined) {
    return { name, fleet: undefined, errors }
  }
  // description is presentation-only — unlike the functional fields above, a
  // wrong-typed value degrades to absent rather than erroring.
  return {
    name,
    fleet: {
      name,
      description: isNonEmptyString(raw.description) ? raw.description : undefined,
      steps: stepsResult.steps,
    },
    errors: [],
  }
}

const findDuplicateFleetNames = (parsed: readonly FleetParse[]): readonly FleetError[] => {
  const counts = new Map<string, number>()
  for (const p of parsed) {
    if (p.name !== undefined) counts.set(p.name, (counts.get(p.name) ?? 0) + 1)
  }
  return parsed
    .filter((p) => p.name !== undefined && (counts.get(p.name) ?? 0) > 1)
    .map((p) =>
      fleetErr({
        fleet: p.name as string,
        step: undefined,
        message: `duplicate fleet name: "${p.name}"`,
      }),
    )
}

// Validates an untrusted `fleet.json` body. Collects EVERY error across every
// fleet and step rather than stopping at the first — a hand-edited recipe
// wants the full list of what to fix in one pass, the same way `tsc` reports
// every diagnostic instead of quitting after the first.
export const parseFleetFile = (
  raw: unknown,
): Either.Either<FleetFile, ReadonlyArray<FleetError>> => {
  if (!isPlainObject(raw) || !Array.isArray(raw.fleets)) {
    return Either.left([
      fleetErr({
        fleet: "(file)",
        step: undefined,
        message: "root must be an object with a `fleets` array",
      }),
    ])
  }
  const parsed = raw.fleets.map((f, index) => parseOneFleet({ raw: f, index }))
  const errors = [...parsed.flatMap((p) => p.errors), ...findDuplicateFleetNames(parsed)]
  if (errors.length > 0) return Either.left(errors)
  return Either.right({ fleets: parsed.map((p) => p.fleet as Fleet) })
}
