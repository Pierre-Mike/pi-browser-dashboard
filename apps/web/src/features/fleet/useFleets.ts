import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { parseFleetsResponse } from "./fleetParse"
import type { FleetsResponse } from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

const fleetsKey = (projectId: string) => ["fleets", "project", projectId] as const

// GET /projects/:id/fleets: the project's recipe(s), wave-grouped, or every
// validation error blocking them (see FleetsResponse — the two never mix).
export const useFleets = (projectId: string) =>
  useQuery<FleetsResponse>({
    queryKey: fleetsKey(projectId),
    enabled: projectId !== "",
    queryFn: async () => {
      const res = await client.projects[":id"].fleets.$get({ param: { id: projectId } })
      if (!res.ok) throw new Error(`fleets: HTTP ${res.status}`)
      return parseFleetsResponse(await res.json())
    },
    staleTime: 10_000,
  })
