import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { type Brainstorm, brainstormsQueryKey, type CreatableBrainstormKind } from "./brainstorms"
import { parseBrainstorm, parseBrainstorms } from "./brainstorms.parse"

// Every board in this session's worktree — any `*.canvas`, `*.canvas.json` or
// `*.excalidraw` file, wherever it sits. Short staleTime so a board the session
// itself just created (or a `git pull`) shows up soon after a tab revisit. The
// hook is exercised end-to-end via Playwright against the live daemon (repo
// convention, mirrors usePidApps).
export const useBrainstorms = (short: string) =>
  useQuery<Brainstorm[]>({
    queryKey: brainstormsQueryKey(short),
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[short].brainstorms.$get()
      if (!res.ok) throw new Error(`brainstorms: HTTP ${res.status}`)
      const boards = parseBrainstorms(await res.json())
      if (!boards) throw new Error("brainstorms: malformed response")
      return boards
    },
    enabled: short !== "",
    staleTime: 5_000,
  })

// Creates an empty board at `brainstorms/<name>.<ext>` inside the session's
// worktree — a default location, not a fixed one: the user (or the session) can
// move the file anywhere and it stays a board. Invalidates this session's list
// on success so the new board appears without a manual refetch.
export const useCreateBrainstorm = (short: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      readonly name: string
      readonly kind: CreatableBrainstormKind
    }): Promise<Brainstorm> => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[short].brainstorms.$post({ json: input })
      if (!res.ok) throw new Error(`brainstorms: HTTP ${res.status}`)
      const board = parseBrainstorm(await res.json())
      if (!board) throw new Error("brainstorms: malformed response")
      return board
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brainstormsQueryKey(short) })
    },
  })
}
