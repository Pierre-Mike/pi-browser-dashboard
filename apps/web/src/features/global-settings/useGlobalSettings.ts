import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { GlobalSettings, GlobalSettingsPatch } from "./types"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

const KEY = ["global-settings"]

export const useGlobalSettings = () =>
  useQuery<GlobalSettings>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await client.settings.$get()
      if (!res.ok) throw new Error(`global-settings: HTTP ${res.status}`)
      return (await res.json()) as GlobalSettings
    },
    staleTime: 10_000,
  })

export const useUpdateGlobalSettings = () => {
  const qc = useQueryClient()
  return useMutation<GlobalSettings, Error, GlobalSettingsPatch>({
    mutationFn: async (patch) => {
      const res = await client.settings.$post({ json: patch })
      if (!res.ok) throw new Error(`global-settings update: HTTP ${res.status}`)
      return (await res.json()) as GlobalSettings
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  })
}
