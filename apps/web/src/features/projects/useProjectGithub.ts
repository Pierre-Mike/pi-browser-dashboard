import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { GithubProjectSummary } from "../../lib/types"

export const useProjectGithub = (projectId: string, enabled: boolean) =>
  useQuery<GithubProjectSummary>({
    queryKey: ["projects", projectId, "github"],
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    staleTime: 30_000,
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects[":id"].github.$get({ param: { id: projectId } })
      if (!res.ok) throw new Error(`projects/${projectId}/github: HTTP ${res.status}`)
      return (await res.json()) as GithubProjectSummary
    },
  })
