import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { type PidApp, pidAppsQueryKey } from "./pidApps"

// Per-project list of pid-apps discovered under <project>/.pid/. The short
// staleTime means an app dropped into .pid/ shows up soon after a tab revisit.
// The hook is exercised end-to-end via Playwright against the live daemon.
export const usePidApps = (projectId: string) =>
  useQuery<PidApp[]>({
    queryKey: pidAppsQueryKey(projectId),
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects[projectId]["pid-apps"].$get()
      if (!res.ok) throw new Error(`pid-apps: HTTP ${res.status}`)
      return (await res.json()) as PidApp[]
    },
    enabled: projectId !== "",
    staleTime: 5_000,
  })

// Creates a new pid-app under <project>/.pid/<name>/ from the daemon's starter
// HTML template. Invalidates this project's pid-apps list on success so the
// new tab appears without a manual refetch.
export const useCreatePidApp = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string): Promise<PidApp> => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.projects[projectId]["pid-apps"].$post({ json: { name } })
      if (!res.ok) throw new Error(`pid-apps: HTTP ${res.status}`)
      return (await res.json()) as PidApp
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pidAppsQueryKey(projectId) })
    },
  })
}
