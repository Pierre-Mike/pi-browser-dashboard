import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { GithubProjectSummary } from "../../lib/types"

// `git pull --ff-only` result mirrored from the daemon (git.core.ts).
type GitPullResult = {
  readonly alreadyUpToDate: boolean
  readonly output: string
}

// The inline PR-diff viewer's payload: a single PR's unified patch, or an empty
// diff plus a warning when `gh pr diff` could not produce one. Mirrors the
// daemon's GithubPrDiff (github.core.ts).
type GithubPrDiff = {
  readonly diff: string
  readonly warning?: string
}

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

// Fast-forward pull for a project. On success, refresh the GitHub summary and
// any git-status overlay so the PR list / file badges reflect the new HEAD.
export const useProjectGitPull = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation<GitPullResult>({
    mutationFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects[":id"].git.pull.$post({ param: { id: projectId } })
      if (!res.ok) throw new Error(`projects/${projectId}/git/pull: HTTP ${res.status}`)
      return (await res.json()) as GitPullResult
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
  useQuery<GithubPrDiff>({
    queryKey: ["projects", projectId, "pr-diff", prNumber],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const params = { param: { id: projectId, prNumber: String(prNumber) } }
      const res = await client.projects[":id"].github.pr[":prNumber"].diff.$get(params)
      if (!res.ok) throw new Error(`pr ${prNumber} diff: HTTP ${res.status}`)
      return (await res.json()) as GithubPrDiff
    },
  })
