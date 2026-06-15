import type { Project, SessionState } from "../../lib/types"

export type SidebarBucket = {
  key: string
  title: string
  pathHint: string
  sessions: SessionState[]
  project: Project | null
  pinned: boolean
}

// The single home for sessions not (yet) linked to a project — ad-hoc questions
// and new-repo spawns land here, then move into a project bucket once their cwd
// matches one. Always rendered first when it holds any session.
export const DEFAULT_BUCKET_KEY = "default"

const sessionRecency = (s: SessionState): number => {
  const t = Date.parse(s.updatedAt)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

// Recent activity on top; unparseable timestamps sink (stable sort keeps their
// relative input order).
const byRecency = (x: SessionState, y: SessionState): number =>
  sessionRecency(y) - sessionRecency(x)

export const bucketProjects = ({
  projects,
  sessions,
  pinnedIds = new Set(),
}: {
  projects: readonly Project[]
  sessions: readonly SessionState[]
  pinnedIds?: ReadonlySet<string>
}): readonly SidebarBucket[] => {
  const byPath = new Map<string, Project>()
  for (const p of projects) byPath.set(p.path, p)

  const byKey = new Map<string, SidebarBucket>()
  for (const p of projects) {
    byKey.set(`p:${p.id}`, {
      key: `p:${p.id}`,
      title: p.name,
      pathHint: p.path,
      sessions: [],
      project: p,
      pinned: false,
    })
  }
  const defaultBucket: SidebarBucket = {
    key: DEFAULT_BUCKET_KEY,
    title: "Default",
    pathHint: "",
    sessions: [],
    project: null,
    pinned: false,
  }
  for (const s of sessions) {
    const proj = byPath.get(s.cwd)
    if (proj) byKey.get(`p:${proj.id}`)?.sessions.push(s)
    else defaultBucket.sessions.push(s)
  }

  for (const b of byKey.values()) {
    if (b.project && pinnedIds.has(b.project.id)) b.pinned = true
    b.sessions.sort(byRecency)
  }
  defaultBucket.sessions.sort(byRecency)

  // pinnedIds iterates in pin order (topmost first per the user's manual
  // ranking); index it so two pinned buckets sort by that rank rather than by
  // session count.
  const pinRank = new Map<string, number>()
  let r = 0
  for (const id of pinnedIds) pinRank.set(id, r++)
  const rankOf = (b: SidebarBucket): number =>
    b.project ? (pinRank.get(b.project.id) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY

  const out = [...byKey.values()]
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.pinned && b.pinned) return rankOf(a) - rankOf(b)
    if (a.sessions.length !== b.sessions.length) return b.sessions.length - a.sessions.length
    return a.title.localeCompare(b.title)
  })
  // Default always leads — it's the landing zone for new, unlinked sessions —
  // but stays hidden until it actually holds one (no empty box at the top).
  return defaultBucket.sessions.length > 0 ? [defaultBucket, ...out] : out
}

export const SESSION_PAGE_SIZE = 5

export type SessionWindow = {
  visible: readonly SessionState[]
  hiddenCount: number
}

export const sessionWindow = ({
  sessions,
  limit,
}: {
  sessions: readonly SessionState[]
  limit: number
}): SessionWindow => {
  const visible = sessions.slice(0, Math.max(0, limit))
  return { visible, hiddenCount: sessions.length - visible.length }
}

export const growLimit = (limit: number): number => limit + SESSION_PAGE_SIZE

export const sessionMoreLabel = (hiddenCount: number): string => {
  const next = Math.min(hiddenCount, SESSION_PAGE_SIZE)
  return hiddenCount > SESSION_PAGE_SIZE
    ? `Show ${next} more (${hiddenCount} hidden)`
    : `Show ${next} more`
}

export const sessionLabel = (s: SessionState): string => s.name?.trim() || s.short

export const activeProjectId = (pathname: string): string | null => {
  const m = pathname.match(/^\/projects\/([^/]+)\/?$/)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

// Drag-to-reorder predicates for sidebar rows. Only a pinned project can be
// dragged or be a drop target; each predicate stays at a couple of conditions
// so the row component reads as data, not branching.
export const pinnedProjectId = (bucket: SidebarBucket): string | null =>
  bucket.pinned && bucket.project ? bucket.project.id : null

// A pinned row is a drop target for the active drag unless it's the row being
// dragged. Returns the droppable id, or null when it can't accept.
export const dropTargetId = (pinnedId: string | null, draggingId: string | null): string | null =>
  pinnedId && draggingId && draggingId !== pinnedId ? pinnedId : null

export const isOverTarget = (target: string | null, overId: string | null): boolean =>
  target !== null && overId === target

export const isDraggingSelf = (draggingId: string | null, selfId: string | undefined): boolean =>
  draggingId !== null && draggingId === selfId
