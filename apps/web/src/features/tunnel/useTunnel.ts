import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"

export type TunnelStatus = "stopped" | "starting" | "running" | "error"

// Local to this hook — not exported (no external consumer).
interface TunnelState {
  readonly status: TunnelStatus
  readonly url: string | null
  readonly error?: string
}

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
const client = api as any

const KEY = ["tunnel", "status"] as const

export const useTunnelStatus = () =>
  useQuery<TunnelState>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await client.tunnel.status.$get()
      if (!res.ok) throw new Error(`tunnel status: HTTP ${res.status}`)
      return (await res.json()) as TunnelState
    },
    // While starting, poll so the URL appears as soon as cloudflared reports it.
    refetchInterval: (q) => (q.state.data?.status === "starting" ? 1500 : false),
    staleTime: 2000,
  })

export const useStartTunnel = () => {
  const qc = useQueryClient()
  return useMutation<TunnelState>({
    mutationFn: async () => {
      const res = await client.tunnel.start.$post()
      if (!res.ok) throw new Error(`tunnel start: HTTP ${res.status}`)
      return (await res.json()) as TunnelState
    },
    onSuccess: (next) => qc.setQueryData(KEY, next),
  })
}

export const useStopTunnel = () => {
  const qc = useQueryClient()
  return useMutation<TunnelState>({
    mutationFn: async () => {
      const res = await client.tunnel.stop.$post()
      if (!res.ok) throw new Error(`tunnel stop: HTTP ${res.status}`)
      return (await res.json()) as TunnelState
    },
    onSuccess: (next) => qc.setQueryData(KEY, next),
  })
}
