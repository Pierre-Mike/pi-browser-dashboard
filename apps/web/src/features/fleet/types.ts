// Wire shapes mirrored from the daemon's fleet slice
// (apps/daemon/src/features/fleet/{fleet.core,fleet-run.core,fleet-run.io}.ts).
// Kept as a literal copy rather than an import — the web app cannot reach into
// the daemon's internals, only its typed RPC surface — same precedent
// fleet-run.core.ts itself uses for SessionStateSlug etc.

export type FleetStepWire = {
  readonly id: string
  readonly intent: string
  readonly n: number
  readonly agent: string | undefined
  readonly cwd: string | undefined
  readonly needs: readonly string[]
  readonly until: readonly string[] | undefined
  readonly timeoutMs: number | undefined
}

// One fleet as returned by GET /projects/:id/fleets: its schema plus the wave
// grouping (arrays of step ids) the daemon computes from `needs`.
export type FleetWire = {
  readonly name: string
  readonly description: string | undefined
  readonly steps: readonly FleetStepWire[]
  readonly waves: readonly (readonly string[])[]
}

export type FleetErrorWire = {
  readonly fleet: string
  readonly step: string | undefined
  readonly message: string
}

// GET /projects/:id/fleets is all-or-nothing: any validation error anywhere in
// the file empties `fleets` and fills `errors` — there is no such thing as
// "3 good fleets and 1 bad one" on the wire.
export type FleetsResponse = {
  readonly fleets: readonly FleetWire[]
  readonly errors: readonly FleetErrorWire[]
}

// The execution plan a dry run (or a real run's 202) reports: waves of steps
// flattened out of the recipe, plus the caps the engine will run under.
export type RunPlanWire = {
  readonly fleet: string
  readonly waves: readonly (readonly FleetStepWire[])[]
  readonly totalSessions: number
  readonly maxConcurrentSpawns: number
}

// The result of POST /projects/:id/fleets/:name/run, discriminated across
// every status the daemon can answer with (200/202/400/404/409) so a caller
// can switch on `_tag` instead of re-deriving meaning from an HTTP code.
export type RunAttemptResult =
  | { readonly _tag: "DryRun"; readonly plan: RunPlanWire }
  | {
      readonly _tag: "Started"
      readonly runId: string
      readonly waves: readonly (readonly FleetStepWire[])[]
      readonly totalSessions: number
    }
  | { readonly _tag: "AlreadyActive"; readonly runId: string }
  | { readonly _tag: "CapExceeded"; readonly requested: number; readonly max: number }
  | { readonly _tag: "InvalidRecipe"; readonly errors: readonly FleetErrorWire[] }
  | { readonly _tag: "InvalidBody"; readonly message: string }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "UnknownError"; readonly status: number }

export type WaitOutcomeWire =
  | { readonly _tag: "Satisfied"; readonly state: string; readonly waitedMs: number }
  | { readonly _tag: "Timeout"; readonly waitedMs: number }
  | { readonly _tag: "OccupantChanged" }
  | { readonly _tag: "Removed" }
  | { readonly _tag: "NotFound" }

export type ShortOutcomeWire = {
  readonly short: string
  readonly wait: WaitOutcomeWire | undefined
}

export type StepStatus = "pending" | "spawning" | "waiting" | "done" | "failed" | "skipped"
export type RunStatus = "running" | "done" | "failed"

export type StepSummaryWire = {
  readonly stepId: string
  readonly waveIndex: number
  readonly intent: string
  readonly n: number
  readonly status: StepStatus
  readonly shorts: readonly ShortOutcomeWire[]
  readonly reason: string | undefined
}

export type RunSummaryWire = {
  readonly id: string
  readonly projectId: string
  readonly fleet: string
  readonly status: RunStatus
  readonly totalSessions: number
  readonly startedAt: number
  readonly finishedAt: number | undefined
  readonly steps: readonly StepSummaryWire[]
}
