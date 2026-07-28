import { Link } from "@tanstack/react-router"
import {
  relativeAge,
  runStatusLabel,
  runStatusTone,
  stepStatusLabel,
  stepStatusTone,
} from "./fleetFormat"
import type { RunSummaryWire, ShortOutcomeWire, StepSummaryWire, WaitOutcomeWire } from "./types"

const waitOutcomeLabel = (wait: WaitOutcomeWire | undefined): string | null => {
  if (!wait) return null
  if (wait._tag === "Satisfied")
    return `reached ${wait.state} (${Math.round(wait.waitedMs / 1000)}s)`
  if (wait._tag === "Timeout") return `timed out after ${Math.round(wait.waitedMs / 1000)}s`
  if (wait._tag === "OccupantChanged") return "occupant changed while waiting"
  if (wait._tag === "Removed") return "session was removed while waiting"
  return "session was not found"
}

// A spawned instance, linked to its session drill-in (same route/params
// SessionReplyModal's "Open full session →" uses) so a user can jump straight
// from a step to the agent doing it.
const ShortRow = ({ short }: { short: ShortOutcomeWire }) => (
  <div data-testid="fleet-run-short" className="flex items-center gap-2 text-[11px]">
    <Link
      to="/sessions/$id"
      params={{ id: short.short }}
      data-testid="fleet-run-short-link"
      className="font-mono text-primary hover:underline"
    >
      {short.short}
    </Link>
    {waitOutcomeLabel(short.wait) ? (
      <span className="text-base-content/60">{waitOutcomeLabel(short.wait)}</span>
    ) : null}
  </div>
)

// One step's row: a status chip (tone shared with session cards — see
// fleetFormat's stepStatusTone), its intent, a skip/fail reason when present,
// and every short it spawned. `skipped` and `failed` deliberately render with
// different tones — "we never tried this" and "this broke" are different
// facts, and the reason text spells out which one happened.
const StepRow = ({ step }: { step: StepSummaryWire }) => {
  const tone = stepStatusTone(step.status)
  return (
    <div
      data-testid="fleet-run-step"
      data-status={step.status}
      className="flex flex-col gap-1 rounded border border-base-300/60 p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">{step.stepId}</span>
        <span
          className={`badge badge-sm uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
        >
          {stepStatusLabel(step.status)}
        </span>
      </div>
      <p className="text-xs text-base-content/70">{step.intent}</p>
      {step.reason ? (
        <p data-testid="fleet-run-step-reason" className="text-xs text-base-content/50 italic">
          {step.reason}
        </p>
      ) : null}
      {step.shorts.length > 0 ? (
        <div className="flex flex-col gap-0.5 pl-1">
          {step.shorts.map((short) => (
            <ShortRow key={short.short} short={short} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

type Props = { readonly run: RunSummaryWire }

// One run's per-step progress: a run-level status chip plus every step in
// wave order underneath. Anchored by id so the panel's "Run in progress →"
// link can scroll straight to the active run.
export const FleetRunView = ({ run }: Props) => {
  const tone = runStatusTone(run.status)
  return (
    <div
      id={`fleet-run-${run.id}`}
      data-testid="fleet-run-card"
      data-run-status={run.status}
      className="card border border-base-300 bg-base-100 shadow-sm"
    >
      <div className="card-body gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm">{run.fleet}</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-base-content/50">
              {relativeAge(run.startedAt)} ago
            </span>
            <span
              className={`badge badge-sm uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
            >
              {runStatusLabel(run.status)}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {run.steps.map((step) => (
            <StepRow key={step.stepId} step={step} />
          ))}
        </div>
      </div>
    </div>
  )
}
