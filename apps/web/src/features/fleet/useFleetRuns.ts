import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { parseFleetRunsResponse } from "./fleetParse"
import type { RunSummaryWire } from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

export const fleetRunsKey = (projectId: string) => ["fleet-runs", "project", projectId] as const

// Seeds from GET /projects/:id/fleet-runs once; lib/sse.ts's `fleet.run`
// listener then patches this same cache entry as a run progresses, the same
// seed-then-patch split useTerminalState's `terminal.state` tap uses — this
// hook never needs to poll.
export const useFleetRuns = (projectId: string) =>
  useQuery<readonly RunSummaryWire[]>({
    queryKey: fleetRunsKey(projectId),
    enabled: projectId !== "",
    queryFn: async () => {
      const res = await client.projects[":id"]["fleet-runs"].$get({ param: { id: projectId } })
      if (!res.ok) throw new Error(`fleet-runs: HTTP ${res.status}`)
      return parseFleetRunsResponse(await res.json())
    },
    staleTime: 10_000,
  })
