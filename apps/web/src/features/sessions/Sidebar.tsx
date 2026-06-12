import { Link, useLocation, useParams } from "@tanstack/react-router"
import { useState } from "react"
import type { Project } from "../../lib/types"
import { SpawnModal } from "../dispatch/SpawnModal"
import { NotifyToggle } from "../notifications/NotifyToggle"
import { useProjects } from "../projects/useProjects"
import { SessionContextMenu } from "./SessionContextMenu"
import { type SessionMenu, SidebarBucket } from "./SidebarBucket"
import {
  activeProjectId,
  bucketProjects,
  growLimit,
  SESSION_PAGE_SIZE,
  sessionWindow,
} from "./sidebarUtil"
import { useCollapsedBuckets } from "./useCollapsedBuckets"
import { usePinnedProjects } from "./usePinnedProjects"
import { useSessions } from "./useSessions"

export const Sidebar = () => {
  const sessionsQ = useSessions()
  const projectsQ = useProjects()
  const params = useParams({ strict: false }) as { id?: string }
  const activeShort = params.id
  const pathname = useLocation({ select: (l) => l.pathname })
  const activeProject = activeProjectId(pathname)
  const [spawnProject, setSpawnProject] = useState<Project | null>(null)
  const [sessionMenu, setSessionMenu] = useState<SessionMenu | null>(null)
  const { pinnedIds, togglePin, reorderPin } = usePinnedProjects()
  const { isCollapsed, toggleCollapsed } = useCollapsedBuckets()
  // Per-bucket visible-session cap; ephemeral on purpose — a fresh load
  // snaps every project back to the latest SESSION_PAGE_SIZE sessions.
  const [sessionLimits, setSessionLimits] = useState<Record<string, number>>({})
  const showMore = (key: string) =>
    setSessionLimits((prev) => ({ ...prev, [key]: growLimit(prev[key] ?? SESSION_PAGE_SIZE) }))
  // Drag-to-reorder pinned projects. dragPinId is the project being dragged;
  // overPinId is the pinned row it's currently hovering (drop-before target).
  const [dragPinId, setDragPinId] = useState<string | null>(null)
  const [overPinId, setOverPinId] = useState<string | null>(null)
  const drag = {
    draggingId: dragPinId,
    overId: overPinId,
    onStart: setDragPinId,
    onOver: setOverPinId,
    onLeave: (id: string) => setOverPinId((prev) => (prev === id ? null : prev)),
    onDrop: (id: string) => {
      if (dragPinId) reorderPin(dragPinId, id)
      setDragPinId(null)
      setOverPinId(null)
    },
    onEnd: () => {
      setDragPinId(null)
      setOverPinId(null)
    },
  }

  if (sessionsQ.isLoading || projectsQ.isLoading) {
    return (
      <aside className="hidden md:block w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-500">
        Loading…
      </aside>
    )
  }

  const buckets = bucketProjects({
    projects: projectsQ.data ?? [],
    sessions: sessionsQ.data ?? [],
    pinnedIds,
  })
  const totalSessions = buckets.reduce((n, b) => n + b.sessions.length, 0)

  return (
    <aside
      data-testid="sidebar"
      className="hidden md:flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-screen sticky top-0 overflow-y-auto"
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
        <Link
          to="/"
          data-testid="sidebar-projects-link"
          className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-300 hover:underline"
        >
          Projects
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
            {buckets.length} · {totalSessions} session{totalSessions === 1 ? "" : "s"}
          </span>
          <NotifyToggle />
        </div>
      </div>
      <nav className="flex-1 py-1 divide-y divide-slate-100 dark:divide-slate-900/70">
        {buckets.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500">No projects yet.</div>
        ) : (
          buckets.map((b) => {
            const { visible, hiddenCount } = sessionWindow({
              sessions: b.sessions,
              limit: sessionLimits[b.key] ?? SESSION_PAGE_SIZE,
            })
            return (
              <SidebarBucket
                key={b.key}
                bucket={b}
                active={b.project !== null && b.project.id === activeProject}
                collapsed={isCollapsed(b.key)}
                activeShort={activeShort}
                visible={visible}
                hiddenCount={hiddenCount}
                drag={drag}
                onToggleCollapsed={toggleCollapsed}
                onTogglePin={togglePin}
                onSpawn={setSpawnProject}
                onShowMore={showMore}
                onSessionMenu={setSessionMenu}
              />
            )
          })
        )}
      </nav>
      <Link
        to="/"
        className="border-t border-slate-200 dark:border-slate-800 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900"
      >
        ← Back to project grid
      </Link>
      <SpawnModal
        open={spawnProject !== null}
        project={spawnProject}
        onClose={() => setSpawnProject(null)}
      />
      {sessionMenu ? (
        <SessionContextMenu
          short={sessionMenu.short}
          x={sessionMenu.x}
          y={sessionMenu.y}
          onClose={() => setSessionMenu(null)}
        />
      ) : null}
    </aside>
  )
}
