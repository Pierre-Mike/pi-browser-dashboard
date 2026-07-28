import { useQuery } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { type TerminalStateEvent, terminalStateKey } from "./terminalState"

export const TERMINAL_STATES_QUERY_KEY = ["terminal-states"] as const

const fetchTerminalStates = async (): Promise<Record<string, TerminalStateEvent>> => {
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  const res = await client.terminal.states.$get()
  if (!res.ok) throw new Error(`terminal/states: HTTP ${res.status}`)
  const body: unknown = await res.json()
  return body as Record<string, TerminalStateEvent>
}

// Seeds from GET /terminal/states once per app lifetime (staleTime: Infinity)
// so a client that opens a terminal late still gets a chip immediately;
// lib/sse.ts's `terminal.state` handler keeps the same cache entry fresh via
// setQueryData as transitions arrive, so this hook never needs to poll.
export const useTerminalState = (input: {
  readonly scope: string
  readonly id: string
}): TerminalStateEvent | undefined => {
  const { data } = useQuery<Record<string, TerminalStateEvent>>({
    queryKey: TERMINAL_STATES_QUERY_KEY,
    queryFn: fetchTerminalStates,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: input.id.length > 0,
  })
  return data?.[terminalStateKey(input)]
}
