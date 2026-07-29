import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { GithubProjectSummary } from "../../lib/types"
import {
  parseGithubPrDiff,
  parseGithubProjectSummary,
  parseGitPullResult,
} from "./projectGithub.parse"

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
      const summary = parseGithubProjectSummary(await res.json())
      if (!summary) throw new Error(`projects/${projectId}/github: malformed response`)
      return summary
    },
  })

// Fast-forward pull for a project. On success, refresh the GitHub summary and
// any git-status overlay so the PR list / file badges reflect the new HEAD.
export const useProjectGitPull = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects[":id"].git.pull.$post({ param: { id: projectId } })
      if (!res.ok) throw new Error(`projects/${projectId}/git/pull: HTTP ${res.status}`)
      const result = parseGitPullResult(await res.json())
      if (!result) throw new Error(`projects/${projectId}/git/pull: malformed response`)
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", projectId, "github"] })
      qc.invalidateQueries({ queryKey: ["projects", projectId, "git-status"] })
    },
  })
}

// Lazily fetch a PR's diff (only once its row is expanded). Cached per PR so
// collapsing and re-expanding doesn't refetch within the stale window.
export const useProjectPrDiff = (
  projectId: string,
  { prNumber, enabled }: { prNumber: number; enabled: boolean },
) =>
  useQuery({
    queryKey: ["projects", projectId, "pr-diff", prNumber],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const params = { param: { id: projectId, prNumber: String(prNumber) } }
      const res = await client.projects[":id"].github.pr[":prNumber"].diff.$get(params)
      if (!res.ok) throw new Error(`pr ${prNumber} diff: HTTP ${res.status}`)
      const diff = parseGithubPrDiff(await res.json())
      if (!diff) throw new Error(`pr ${prNumber} diff: malformed response`)
      return diff
    },
  })
