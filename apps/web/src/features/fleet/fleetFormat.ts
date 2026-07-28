// Pure formatting/derivation for the fleet panel: plan summaries, run
// rollups, relative ages, and the tone/label mapping that lets a step's or
// run's status read like a session's status (lib/format.ts's PALETTE) without
// conflating "skipped" with "failed" — those are different facts and must
// stay visually distinct.

import { stateColor } from "../../lib/format"
import type { SessionStateValue } from "../../lib/types"
import type { FleetWire, RunStatus, RunSummaryWire, StepStatus } from "./types"

type SessionTone = ReturnType<typeof stateColor>

export const totalSessionsOf = (fleet: FleetWire): number =>
  fleet.steps.reduce((sum, step) => sum + step.n, 0)

export const waveCountOf = (fleet: FleetWire): number => fleet.waves.length

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`

// The exact-cost sentence the Run confirm dialog shows — the one place in the
// panel that states, in plain words, what a click is about to spend.
export const confirmRunCopy = ({
  fleetName,
  projectName,
  totalSessions,
  waveCount,
}: {
  readonly fleetName: string
  readonly projectName: string
  readonly totalSessions: number
  readonly waveCount: number
}): string =>
  `This starts ${plural(totalSessions, "agent session")} across ${plural(waveCount, "wave")} in "${projectName}", running the "${fleetName}" fleet against your own account's usage.`

// `pending`/`spawning`/`waiting` map onto the same session states a card
// already uses, so a reader who knows those tones for free reads a step's
// status the same way. `skipped` deliberately maps to the muted/neutral
// "stopped" tone rather than "failed" — skipping a step because a dependency
// didn't complete is not the same fact as the step itself breaking, and the
// two must not share a colour.
const STEP_STATUS_TO_SESSION_STATE: Record<StepStatus, SessionStateValue> = {
  pending: "idle",
  spawning: "working",
  waiting: "working",
  done: "done",
  failed: "failed",
  skipped: "stopped",
}

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  spawning: "Spawning",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
}

export const stepStatusTone = (status: StepStatus): SessionTone =>
  stateColor(STEP_STATUS_TO_SESSION_STATE[status])

export const stepStatusLabel = (status: StepStatus): string => STEP_STATUS_LABEL[status]

const RUN_STATUS_TO_SESSION_STATE: Record<RunStatus, SessionStateValue> = {
  running: "working",
  done: "done",
  failed: "failed",
}

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
}

export const runStatusTone = (status: RunStatus): SessionTone =>
  stateColor(RUN_STATUS_TO_SESSION_STATE[status])

export const runStatusLabel = (status: RunStatus): string => RUN_STATUS_LABEL[status]

export const stepProgress = (
  run: RunSummaryWire,
): { readonly done: number; readonly total: number } => ({
  done: run.steps.filter((s) => s.status === "done").length,
  total: run.steps.length,
})

// Same bucketing as lib/format.ts's ageStr, but over an epoch-ms number (what
// the fleet run engine stamps) rather than an ISO string.
export const relativeAge = (ms: number): string => {
  const diff = Math.max(0, Date.now() - ms)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}
