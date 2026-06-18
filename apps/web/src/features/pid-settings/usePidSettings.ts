import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { PidSettings, PidSettingsPatch } from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

const key = (projectId: string) => ["pid-settings", "project", projectId]

export const useProjectPidSettings = (projectId: string) =>
  useQuery<PidSettings>({
    queryKey: key(projectId),
    enabled: projectId !== "",
    queryFn: async () => {
      const res = await client.projects[":id"]["pid-settings"].$get({ param: { id: projectId } })
      if (!res.ok) throw new Error(`pid-settings: HTTP ${res.status}`)
      return (await res.json()) as PidSettings
    },
    staleTime: 10_000,
  })

export const useUpdateProjectPidSettings = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation<PidSettings, Error, PidSettingsPatch>({
    mutationFn: async (patch) => {
      const res = await client.projects[":id"]["pid-settings"].$post({
        param: { id: projectId },
        json: patch,
      })
      if (!res.ok) throw new Error(`pid-settings update: HTTP ${res.status}`)
      return (await res.json()) as PidSettings
    },
    onSuccess: (data) => qc.setQueryData(key(projectId), data),
  })
}
