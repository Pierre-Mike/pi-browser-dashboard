import { useState } from "react"
import { errMsg, FleetView } from "./FleetView"
import type { FleetWire, RunAttemptResult } from "./types"
import { useFleetRuns } from "./useFleetRuns"
import { useFleets } from "./useFleets"
import { useRunFleet } from "./useRunFleet"

type Props = { readonly projectId: string; readonly projectName: string }

// Drops a fleet's stale result entry once its run has actually started — the
// run itself is now tracked in the run list below, not as a leftover mutation
// result on the card.
const withoutFleet = (
  results: Record<string, RunAttemptResult>,
  name: string,
): Record<string, RunAttemptResult> => {
  const { [name]: _dropped, ...rest } = results
  return rest
}

// Project-scoped "Fleets" tab: lists .pid/fleet.json's recipes, previews a run
// (free, no confirmation, spawns nothing), and gates an actual run behind an
// explicit confirm step that states the exact cost — see ConfirmRunDialog.
// Thin wrapper that wires the live query/mutation state into FleetView, the
// same Panel/View split pid-settings uses.
export const FleetPanel = ({ projectId, projectName }: Props) => {
  const fleetsQ = useFleets(projectId)
  const runsQ = useFleetRuns(projectId)
  const runFleet = useRunFleet(projectId)
  const [results, setResults] = useState<Record<string, RunAttemptResult>>({})
  const [confirmFleet, setConfirmFleet] = useState<FleetWire | null>(null)

  const dryRun = (fleet: FleetWire) => {
    runFleet.mutate(
      { name: fleet.name, dryRun: true },
      { onSuccess: (result) => setResults((r) => ({ ...r, [fleet.name]: result })) },
    )
  }

  const confirmRun = () => {
    const fleet = confirmFleet
    if (!fleet) return
    setConfirmFleet(null)
    runFleet.mutate(
      { name: fleet.name, dryRun: false },
      {
        onSuccess: (result) =>
          setResults((r) =>
            result._tag === "Started"
              ? withoutFleet(r, fleet.name)
              : { ...r, [fleet.name]: result },
          ),
      },
    )
  }

  const isPendingFor = (fleet: FleetWire, dryRunFlag: boolean): boolean =>
    runFleet.isPending &&
    runFleet.variables?.name === fleet.name &&
    runFleet.variables?.dryRun === dryRunFlag

  const runs = [...(runsQ.data ?? [])].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <FleetView
      projectName={projectName}
      loading={fleetsQ.isLoading}
      error={fleetsQ.isError ? errMsg(fleetsQ.error, "unknown error") : undefined}
      data={fleetsQ.data}
      runs={runs}
      results={results}
      confirmFleet={confirmFleet}
      isDryRunPending={(fleet) => isPendingFor(fleet, true)}
      isRunPending={(fleet) => isPendingFor(fleet, false)}
      confirmPending={runFleet.isPending}
      onDryRun={dryRun}
      onRequestRun={setConfirmFleet}
      onConfirmRun={confirmRun}
      onCancelRun={() => setConfirmFleet(null)}
    />
  )
}
