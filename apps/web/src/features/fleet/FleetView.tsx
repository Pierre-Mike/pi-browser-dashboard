import { ConfirmRunDialog } from "./ConfirmRunDialog"
import { FleetRunView } from "./FleetRunView"
import { totalSessionsOf, waveCountOf } from "./fleetFormat"
import type {
  FleetErrorWire,
  FleetsResponse,
  FleetWire,
  RunAttemptResult,
  RunPlanWire,
  RunSummaryWire,
} from "./types"

export const errMsg = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : fallback

// A whole-file problem: GET /projects/:id/fleets is all-or-nothing, so any
// validation error anywhere in fleet.json means every fleet is unrunnable
// until the recipe itself is fixed — there is no partial "run the good ones",
// and no Run action is offered while this is showing.
const RecipeErrors = ({ errors }: { readonly errors: readonly FleetErrorWire[] }) => (
  <div
    data-testid="fleet-recipe-errors"
    className="flex flex-col gap-1 rounded-box border border-error/30 bg-error/10 p-3"
  >
    <div className="text-xs font-semibold text-error">
      .pid/fleet.json has {errors.length} problem{errors.length === 1 ? "" : "s"} — fix these before
      any fleet can run:
    </div>
    <ul className="flex flex-col gap-0.5 text-xs text-error/90">
      {errors.map((e) => (
        <li key={`${e.fleet}/${e.step ?? ""}/${e.message}`} className="font-mono">
          {e.fleet}
          {e.step ? `/${e.step}` : ""}: {e.message}
        </li>
      ))}
    </ul>
  </div>
)

const EmptyState = () => (
  <div className="card border border-dashed border-base-300 bg-base-200/40">
    <div
      data-testid="fleet-empty"
      className="card-body items-center gap-1 py-8 text-center text-sm text-base-content/60"
    >
      No fleets yet — add <span className="font-mono text-base-content/80">.pid/fleet.json</span> to
      define one.
    </div>
  </div>
)

const WaveChips = ({ fleet }: { readonly fleet: FleetWire }) => (
  <div data-testid="fleet-waves" className="flex flex-wrap items-center gap-1">
    {fleet.waves.map((wave, i) => (
      <span
        key={wave.join(",") || `wave-${i}`}
        className="inline-flex items-center gap-1 rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/70"
      >
        <span className="font-mono">wave {i + 1}</span>
        <span className="opacity-70">{wave.join(", ")}</span>
      </span>
    ))}
  </div>
)

// The dry-run plan is the primary, no-confirm action's payload: waves,
// per-step `n`, and the total the daemon would actually spawn — spawning
// nothing itself.
const DryRunPlan = ({ plan }: { readonly plan: RunPlanWire }) => (
  <div
    data-testid="fleet-dry-run-plan"
    className="flex flex-col gap-1 rounded-box border border-base-300 bg-base-200/40 p-2 text-xs"
  >
    <div className="font-semibold text-base-content/80">
      Plan: {plan.totalSessions} session{plan.totalSessions === 1 ? "" : "s"} across{" "}
      {plan.waves.length} wave{plan.waves.length === 1 ? "" : "s"} (max {plan.maxConcurrentSpawns}{" "}
      concurrent)
    </div>
    {plan.waves.map((wave, i) => (
      <div key={wave.map((s) => s.id).join(",") || `wave-${i}`} className="pl-2">
        <span className="text-base-content/50">wave {i + 1}:</span>{" "}
        {wave.map((step) => (
          <span key={step.id} className="mr-2 font-mono">
            {step.id}×{step.n}
          </span>
        ))}
      </div>
    ))}
  </div>
)

const RunResultNote = ({ result }: { readonly result: RunAttemptResult }) => {
  if (result._tag === "CapExceeded") {
    return (
      <p data-testid="fleet-run-error" className="text-xs text-error">
        Requested {result.requested} sessions exceeds the cap of {result.max} — trim the recipe
        before running it.
      </p>
    )
  }
  if (result._tag === "AlreadyActive") {
    return (
      <p data-testid="fleet-run-error" className="text-xs text-warning">
        A run is already active for this fleet.
      </p>
    )
  }
  if (
    result._tag === "InvalidRecipe" ||
    result._tag === "InvalidBody" ||
    result._tag === "NotFound"
  ) {
    return (
      <p data-testid="fleet-run-error" className="text-xs text-error">
        {result._tag === "InvalidBody" ? result.message : "The recipe is no longer valid — reload."}
      </p>
    )
  }
  if (result._tag === "UnknownError") {
    return (
      <p data-testid="fleet-run-error" className="text-xs text-error">
        Unexpected response (HTTP {result.status}).
      </p>
    )
  }
  return null
}

// Renders whatever a fleet's last dry-run/run attempt left behind: a plan, an
// explanatory error, or nothing yet. Split out of FleetCard so that ternary
// doesn't add to FleetCard's own branching.
const FleetCardResult = ({ result }: { readonly result: RunAttemptResult | undefined }) => {
  if (!result || result._tag === "Started") return null
  return result._tag === "DryRun" ? (
    <DryRunPlan plan={result.plan} />
  ) : (
    <RunResultNote result={result} />
  )
}

const FleetCardHeader = ({
  fleet,
  totalSessions,
  waveCount,
}: {
  readonly fleet: FleetWire
  readonly totalSessions: number
  readonly waveCount: number
}) => (
  <div className="flex items-start justify-between gap-2">
    <div className="flex min-w-0 flex-col gap-0.5">
      <span data-testid="fleet-card-name" className="truncate text-sm font-medium">
        {fleet.name}
      </span>
      {fleet.description ? (
        <span className="text-xs text-base-content/60">{fleet.description}</span>
      ) : null}
    </div>
    <span className="shrink-0 font-mono text-[11px] text-base-content/50">
      {totalSessions} session{totalSessions === 1 ? "" : "s"} · {waveCount} wave
      {waveCount === 1 ? "" : "s"}
    </span>
  </div>
)

const FleetCardActions = ({
  activeRun,
  dryRunPending,
  runPending,
  onDryRun,
  onRequestRun,
}: {
  readonly activeRun: RunSummaryWire | undefined
  readonly dryRunPending: boolean
  readonly runPending: boolean
  readonly onDryRun: () => void
  readonly onRequestRun: () => void
}) => (
  <div className="flex items-center gap-2 pt-1">
    <button
      type="button"
      data-testid="fleet-dry-run"
      className="btn btn-outline btn-xs normal-case"
      onClick={onDryRun}
      disabled={dryRunPending}
    >
      {dryRunPending ? <span className="loading loading-spinner loading-xs" /> : "Dry run"}
    </button>
    <button
      type="button"
      data-testid="fleet-run"
      className="btn btn-primary btn-xs normal-case"
      onClick={onRequestRun}
      disabled={runPending || activeRun !== undefined}
    >
      Run
    </button>
    {activeRun ? (
      <a
        data-testid="fleet-active-run-link"
        href={`#fleet-run-${activeRun.id}`}
        className="text-[11px] text-primary hover:underline"
      >
        Run in progress →
      </a>
    ) : null}
  </div>
)

const FleetCard = ({
  fleet,
  activeRun,
  result,
  dryRunPending,
  runPending,
  onDryRun,
  onRequestRun,
}: {
  readonly fleet: FleetWire
  readonly activeRun: RunSummaryWire | undefined
  readonly result: RunAttemptResult | undefined
  readonly dryRunPending: boolean
  readonly runPending: boolean
  readonly onDryRun: () => void
  readonly onRequestRun: () => void
}) => (
  <div
    data-testid="fleet-card"
    data-fleet={fleet.name}
    className="card border border-base-300 bg-base-100 shadow-sm"
  >
    <div className="card-body gap-2 p-3">
      <FleetCardHeader
        fleet={fleet}
        totalSessions={totalSessionsOf(fleet)}
        waveCount={waveCountOf(fleet)}
      />
      <WaveChips fleet={fleet} />
      <FleetCardActions
        activeRun={activeRun}
        dryRunPending={dryRunPending}
        runPending={runPending}
        onDryRun={onDryRun}
        onRequestRun={onRequestRun}
      />
      <FleetCardResult result={result} />
    </div>
  </div>
)

// The fleet list itself: loading, error, the whole-file recipe errors, empty,
// or one card per fleet — split out of FleetView so its own five-way branch
// doesn't compound with the confirm-dialog/recent-runs branching below it.
const FleetList = ({
  loading,
  error,
  data,
  runs,
  isDryRunPending,
  isRunPending,
  results,
  onDryRun,
  onRequestRun,
}: {
  readonly loading: boolean
  readonly error: string | undefined
  readonly data: FleetsResponse | undefined
  readonly runs: readonly RunSummaryWire[]
  readonly results: Readonly<Record<string, RunAttemptResult>>
  readonly isDryRunPending: (fleet: FleetWire) => boolean
  readonly isRunPending: (fleet: FleetWire) => boolean
  readonly onDryRun: (fleet: FleetWire) => void
  readonly onRequestRun: (fleet: FleetWire) => void
}) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-base-content/50">
        <span className="loading loading-spinner loading-sm" /> Loading fleets…
      </div>
    )
  }
  if (error) return <div className="text-xs text-error">Failed to load fleets: {error}</div>
  if (!data) return null
  if (data.errors.length > 0) return <RecipeErrors errors={data.errors} />
  if (data.fleets.length === 0) return <EmptyState />

  const activeRunFor = (fleetName: string): RunSummaryWire | undefined =>
    runs.find((r) => r.fleet === fleetName && r.status === "running")

  return (
    <div className="flex flex-col gap-2">
      {data.fleets.map((fleet) => (
        <FleetCard
          key={fleet.name}
          fleet={fleet}
          activeRun={activeRunFor(fleet.name)}
          result={results[fleet.name]}
          dryRunPending={isDryRunPending(fleet)}
          runPending={isRunPending(fleet)}
          onDryRun={() => onDryRun(fleet)}
          onRequestRun={() => onRequestRun(fleet)}
        />
      ))}
    </div>
  )
}

const RecentRuns = ({ runs }: { readonly runs: readonly RunSummaryWire[] }) =>
  runs.length === 0 ? null : (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-wide text-base-content/50">Recent runs</div>
      {runs.map((run) => (
        <FleetRunView key={run.id} run={run} />
      ))}
    </div>
  )

export type FleetViewProps = {
  readonly projectName: string
  readonly loading: boolean
  readonly error: string | undefined
  readonly data: FleetsResponse | undefined
  readonly runs: readonly RunSummaryWire[]
  readonly results: Readonly<Record<string, RunAttemptResult>>
  readonly confirmFleet: FleetWire | null
  readonly isDryRunPending: (fleet: FleetWire) => boolean
  readonly isRunPending: (fleet: FleetWire) => boolean
  readonly confirmPending: boolean
  readonly onDryRun: (fleet: FleetWire) => void
  readonly onRequestRun: (fleet: FleetWire) => void
  readonly onConfirmRun: () => void
  readonly onCancelRun: () => void
}

// Purely presentational — every piece of state (loading/error/data, the
// in-flight mutation, which fleet (if any) is pending confirmation) arrives as
// a prop, mirroring pid-settings' Panel/View split. That is what makes every
// branch below (a rendered plan, the confirm dialog open, an invalid recipe
// hiding Run entirely) directly testable without simulating a click.
export const FleetView = ({
  projectName,
  loading,
  error,
  data,
  runs,
  results,
  confirmFleet,
  isDryRunPending,
  isRunPending,
  confirmPending,
  onDryRun,
  onRequestRun,
  onConfirmRun,
  onCancelRun,
}: FleetViewProps) => (
  <div data-testid="fleet-panel" className="flex flex-col gap-3">
    <FleetList
      loading={loading}
      error={error}
      data={data}
      runs={runs}
      results={results}
      isDryRunPending={isDryRunPending}
      isRunPending={isRunPending}
      onDryRun={onDryRun}
      onRequestRun={onRequestRun}
    />
    <RecentRuns runs={runs} />
    {confirmFleet ? (
      <ConfirmRunDialog
        fleetName={confirmFleet.name}
        projectName={projectName}
        totalSessions={totalSessionsOf(confirmFleet)}
        waveCount={waveCountOf(confirmFleet)}
        pending={confirmPending}
        onConfirm={onConfirmRun}
        onCancel={onCancelRun}
      />
    ) : null}
  </div>
)
