import { decodeSessionState, type SessionState } from "@pid/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { fillViewportClass } from "../features/sessions/navChrome"
import { SessionSplit } from "../features/sessions/SessionSplit"
import { SessionTopbar } from "../features/sessions/SessionTopbar"
import {
  BOARD_TAB_PREFIX,
  SESSION_TABS,
  type SessionPane,
  type SessionTab,
  TERMINAL_ONLY_TAB,
  toggleSessionTab,
} from "../features/sessions/sessionTabs"
import { useSessionActions } from "../features/sessions/useSessionActions"
import { api } from "../lib/api"
import { resolveSessionView } from "../lib/sessionView"
import { coerceNamespacedTab } from "../lib/tabParams"

// `brainstorm:<encoded path>` selects one board inside the Brainstorm section,
// so the deep link has to survive validateSearch instead of being dropped.
type SessionTabParam = SessionTab | `${typeof BOARD_TAB_PREFIX}${string}`

export const Route = createFileRoute("/sessions/$id")({
  validateSearch: (search: Record<string, unknown>): { tab?: SessionTabParam } => {
    const tab = coerceNamespacedTab(search.tab, {
      staticKeys: SESSION_TABS,
      prefixes: [BOARD_TAB_PREFIX],
    })
    return tab === undefined ? {} : { tab }
  },
  component: SessionDrillIn,
})

const useSession = (id: string) =>
  useQuery<SessionState | null>({
    queryKey: ["sessions", id],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].$get({ param: { id } })
      if (!res.ok) return null
      return decodeSessionState(await res.json())
    },
  })

// An invalid id (queryFn resolves to null on a 404) must show a not-found state
// with a back link — never an infinite "Loading session…" with a live action bar
// wired to a phantom session. Mirrors projects.$id.tsx.
const SessionNotFound = ({ id }: { readonly id: string }) => (
  <div className="flex flex-col gap-2">
    <Link to="/" className="btn btn-sm btn-ghost normal-case text-xs">
      ← Dashboard
    </Link>
    <div data-testid="session-not-found" className="text-sm text-base-content/80">
      Session <span className="font-mono">{id}</span> not found.
    </div>
  </div>
)

function SessionDrillIn() {
  const { id } = Route.useParams()
  const sessionQ = useSession(id)
  const session = sessionQ.data
  const actions = useSessionActions({ id, session })

  // No pane docked beside the terminal until the user asks for one.
  const { tab = TERMINAL_ONLY_TAB } = Route.useSearch()
  const navigate = Route.useNavigate()
  const setTab = (next: SessionTabParam) => navigate({ search: (prev) => ({ ...prev, tab: next }) })
  // A dock click toggles: the lit section closes the pane, so the same button
  // that opened it is how the terminal gets its full width back.
  const onSelectDockTab = (key: SessionPane) => setTab(toggleSessionTab({ tab, key }))

  if (resolveSessionView({ isLoading: sessionQ.isLoading, data: session }) === "not-found") {
    return <SessionNotFound id={id} />
  }

  return (
    <div className={`flex flex-col gap-1 ${fillViewportClass} pt-1`}>
      <SessionTopbar
        session={session}
        fallbackId={id}
        tab={tab}
        onSelectTab={onSelectDockTab}
        actions={actions}
      />

      {actions.peekSummary ? (
        <div
          data-testid="peek-summary"
          className="mx-1 rounded-box border border-base-300 bg-base-200 p-2 text-xs text-base-content/80 whitespace-pre-wrap"
        >
          {actions.peekSummary}
        </div>
      ) : null}

      <SessionSplit
        tab={tab}
        id={id}
        session={session}
        onSelectTab={(next) => setTab(next as SessionTabParam)}
      />
    </div>
  )
}
