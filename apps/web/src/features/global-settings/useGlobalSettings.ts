import { decodeGlobalSettings, type GlobalSettings, type GlobalSettingsPatch } from "@pid/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

const KEY = ["global-settings"]

// Both directions decode against the shared contract rather than a hand-written
// local guard: the daemon declares this shape once, in `@pid/shared`, so a field
// it gains cannot arrive here as a silent `undefined`. A decode failure throws,
// which react-query surfaces as `isError` — the same branch an HTTP failure
// takes, and the panel already renders it.
export const useGlobalSettings = () =>
  useQuery<GlobalSettings>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await client.settings.$get()
      if (!res.ok) throw new Error(`global-settings: HTTP ${res.status}`)
      return decodeGlobalSettings(await res.json())
    },
    staleTime: 10_000,
  })

export const useUpdateGlobalSettings = () => {
  const qc = useQueryClient()
  return useMutation<GlobalSettings, Error, GlobalSettingsPatch>({
    mutationFn: async (patch) => {
      const res = await client.settings.$post({ json: patch })
      if (!res.ok) throw new Error(`global-settings update: HTTP ${res.status}`)
      return decodeGlobalSettings(await res.json())
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  })
}
