import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { parseRunAttempt } from "./fleetParse"
import type { RunAttemptResult } from "./types"
import { fleetRunsKey } from "./useFleetRuns"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

type RunFleetInput = { readonly name: string; readonly dryRun: boolean }

// POST /projects/:id/fleets/:name/run. A dry run spawns nothing — the daemon
// only plans and validates against the run caps. A real run's 202 means the
// engine has started walking the waves in the background; refetch the run
// list so the new run shows up even before its first `fleet.run` SSE event
// arrives.
export const useRunFleet = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation<RunAttemptResult, Error, RunFleetInput>({
    mutationFn: async ({ name, dryRun }) => {
      const res = await client.projects[":id"].fleets[":name"].run.$post({
        param: { id: projectId, name },
        json: { dryRun },
      })
      const body = await res.json().catch(() => undefined)
      return parseRunAttempt({ status: res.status, body })
    },
    onSuccess: (result) => {
      if (result._tag === "Started") qc.invalidateQueries({ queryKey: fleetRunsKey(projectId) })
    },
  })
}
