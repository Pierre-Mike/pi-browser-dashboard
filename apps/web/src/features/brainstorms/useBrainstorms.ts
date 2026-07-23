import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { type Brainstorm, type BrainstormKind, brainstormsQueryKey } from "./brainstorms"

// Per-project list of brainstorm canvases discovered under
// <project>/.pid/brainstorms/. Short staleTime so a document created by an
// agent (or a git pull) shows up soon after a tab revisit. The hook is
// exercised end-to-end via Playwright against the live daemon (repo
// convention, mirrors usePidApps).
export const useBrainstorms = (projectId: string) =>
  useQuery<Brainstorm[]>({
    queryKey: brainstormsQueryKey(projectId),
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects[projectId].brainstorms.$get()
      if (!res.ok) throw new Error(`brainstorms: HTTP ${res.status}`)
      return (await res.json()) as Brainstorm[]
    },
    enabled: projectId !== "",
    staleTime: 5_000,
  })

// Creates a new empty brainstorm document (canvas or excalidraw) under
// <project>/.pid/brainstorms/. Invalidates this project's list on success so
// the new board appears without a manual refetch.
export const useCreateBrainstorm = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      readonly name: string
      readonly kind: BrainstormKind
    }): Promise<Brainstorm> => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects[projectId].brainstorms.$post({ json: input })
      if (!res.ok) throw new Error(`brainstorms: HTTP ${res.status}`)
      return (await res.json()) as Brainstorm
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brainstormsQueryKey(projectId) })
    },
  })
}
