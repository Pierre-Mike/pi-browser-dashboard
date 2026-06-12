import type { Project, SessionState } from "../../lib/types"
import { RECENT_LIMIT, recentSessions } from "./recentActivity"
import { SessionCard } from "./SessionCard"

type Props = {
  projects: readonly Project[]
  sessions: readonly SessionState[]
  limit?: number
}

// Cross-project activity feed: the newest sessions across every project, newest
// first, each tagged with its owning project. Stays live because the parent
// feeds it the SSE-patched `["sessions"]` query cache.
export const RecentSessionsFeed = ({ projects, sessions, limit = RECENT_LIMIT }: Props) => {
  const items = recentSessions({ projects, sessions, limit })

  if (items.length === 0) {
    return <div className="text-sm text-slate-500 dark:text-slate-400">No active sessions yet.</div>
  }

  return (
    <div className="flex flex-col gap-3" data-testid="recent-sessions-feed">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span
          className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
          aria-hidden
        />
        <span>Live · {items.length} most recent</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map(({ session, projectName }) => (
          <div key={session.short} className="flex flex-col gap-1" data-testid="recent-session-row">
            <div
              className="text-[11px] font-medium text-slate-400 dark:text-slate-500 truncate"
              title={session.cwd}
            >
              {projectName}
            </div>
            <SessionCard session={session} />
          </div>
        ))}
      </div>
    </div>
  )
}
