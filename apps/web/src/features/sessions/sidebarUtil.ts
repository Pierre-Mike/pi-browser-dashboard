import { cwdTail } from "../../lib/format"
import type { Project, SessionState } from "../../lib/types"

export type SidebarBucket = {
  key: string
  title: string
  pathHint: string
  sessions: SessionState[]
  project: Project | null
  pinned: boolean
}

export const bucketProjects = (
  projects: readonly Project[],
  sessions: readonly SessionState[],
  pinnedIds: ReadonlySet<string> = new Set(),
): readonly SidebarBucket[] => {
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
  for (const s of sessions) {
    const proj = byPath.get(s.cwd)
    if (proj) {
      byKey.get(`p:${proj.id}`)?.sessions.push(s)
      continue
    }
    const k = `c:${s.cwd}`
    const existing = byKey.get(k)
    if (existing) {
      existing.sessions.push(s)
    } else {
      byKey.set(k, {
        key: k,
        title: cwdTail(s.cwd),
        pathHint: s.cwd,
        sessions: [s],
        project: null,
        pinned: false,
      })
    }
  }

  // Pin only applies to project buckets that have at least one session — pin
  // is a "this project is hot right now" marker, not a generic bookmark.
  for (const b of byKey.values()) {
    if (b.project && b.sessions.length > 0 && pinnedIds.has(b.project.id)) {
      b.pinned = true
    }
  }

  const out = [...byKey.values()]
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.sessions.length !== b.sessions.length) return b.sessions.length - a.sessions.length
    return a.title.localeCompare(b.title)
  })
  return out
}

export const sessionLabel = (s: SessionState): string => s.name?.trim() || s.short
