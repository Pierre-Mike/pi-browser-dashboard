import { cwdTail } from "../../lib/format"
import type { Project, SessionState } from "../../lib/types"

export const RECENT_LIMIT = 10

// One row in the cross-project activity feed: the session plus the project it
// runs in (null when no known project owns its cwd) and a display label.
export type RecentItem = {
  session: SessionState
  project: Project | null
  projectName: string
}

const recency = (s: SessionState): number => {
  const t = Date.parse(s.updatedAt)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

// The newest `limit` sessions across every project, each labelled with its
// owning project. Recent activity on top; unparseable timestamps sink (stable
// sort keeps their relative input order).
export const recentSessions = ({
  projects,
  sessions,
  limit = RECENT_LIMIT,
}: {
  projects: readonly Project[]
  sessions: readonly SessionState[]
  limit?: number
}): RecentItem[] => {
  const byPath = new Map<string, Project>()
  for (const p of projects) byPath.set(p.path, p)

  return [...sessions]
    .sort((a, b) => recency(b) - recency(a))
    .slice(0, Math.max(0, limit))
    .map((session) => {
      const project = byPath.get(session.cwd) ?? null
      return { session, project, projectName: project?.name ?? cwdTail(session.cwd) }
    })
}
