import type { Project, SessionState } from "../../lib/types"
import { RECENT_LIMIT, recentSessions } from "./recentActivity"
import { SessionCard } from "./SessionCard"

type Props = {
  projects: readonly Project[]
  sessions: readonly SessionState[]
  limit?: number
  // Cross-project views label each row with its owning project; a single-project
  // view (e.g. a project's Activity tab) sets this false to drop the redundant tag.
  showProjectName?: boolean
}

// Cross-project activity feed: the newest sessions across every project, newest
// first, each tagged with its owning project. Stays live because the parent
// feeds it the SSE-patched `["sessions"]` query cache.
export const RecentSessionsFeed = ({
  projects,
  sessions,
  limit = RECENT_LIMIT,
  showProjectName = true,
}: Props) => {
  const items = recentSessions({ projects, sessions, limit })

  if (items.length === 0) {
    return <div className="text-sm text-base-content/60">No active sessions yet.</div>
  }

  return (
    <div className="flex flex-col gap-2" data-testid="recent-sessions-feed">
      {/* A dedicated row here used to pair this caption with its own pulsing
          dot — redundant with the state colour every SessionCard already
          carries. A compact inline label keeps the text without the row. */}
      <div className="text-[10px] uppercase tracking-wide text-base-content/50">
        Live · {items.length} most recent
      </div>
      <div className="flex flex-col gap-2">
        {items.map(({ session, projectName }) => (
          <div
            key={session.short}
            className="flex items-start gap-3"
            data-testid="recent-session-row"
          >
            {/* The feed row is far wider than a card needs, so the project rides
                in a gutter to its left instead of as a small line on top — at
                row scale it reads, and it costs no extra height. `pt-3` matches
                the card's own padding so the two names sit on one baseline. */}
            {showProjectName ? (
              <div
                data-testid="recent-session-project"
                className="w-28 sm:w-44 shrink-0 pt-3 text-sm font-medium text-base-content/70 truncate"
                title={session.cwd}
              >
                {projectName}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <SessionCard session={session} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
