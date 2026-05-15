import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import type { SessionState } from "../../lib/types"

export const useSessions = () =>
  useQuery<SessionState[]>({
    queryKey: ["sessions"],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions.$get()
      if (!res.ok) throw new Error(`sessions: HTTP ${res.status}`)
      return (await res.json()) as SessionState[]
    },
  })
