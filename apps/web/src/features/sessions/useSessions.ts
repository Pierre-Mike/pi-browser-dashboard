import { decodeSessionStateArray, type SessionState } from "@pid/shared"
import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"

export const useSessions = () =>
  useQuery<SessionState[]>({
    queryKey: ["sessions"],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions.$get()
      if (!res.ok) throw new Error(`sessions: HTTP ${res.status}`)
      // Copied into a mutable array: the decoder's `readonly` element type
      // would otherwise narrow `useQuery`'s inferred data type for every
      // consumer of this hook.
      return [...decodeSessionStateArray(await res.json())]
    },
  })
