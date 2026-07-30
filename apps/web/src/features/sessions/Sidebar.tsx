import { Link, useLocation, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { type UsePersistedFlag, usePersistedFlag } from "../../lib/collapse"
import type { Project } from "../../lib/types"
import { SpawnModal } from "../dispatch/SpawnModal"
import { NotifyToggle } from "../notifications/NotifyToggle"
import { useProjects } from "../projects/useProjects"
import { type SidebarVariant, sidebarAsideClass, sidebarLoadingClass } from "./navChrome"
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

type SidebarProps = {
  readonly variant?: SidebarVariant
  // Whole-rail collapse flag, shared with the pages' NavChromeChips row.
  // Two separate usePersistedFlag instances in the same tab don't sync with
  // each other (the hook only listens for cross-tab storage events), so the
  // desktop call site must pass its own instance down. Optional so the
  // drawer variant (which never reads it) and standalone renders keep working.
  readonly rail?: UsePersistedFlag
}

// No `= {}` default on the parameter: with optional props TypeScript resolves
// `createElement(Sidebar, { rail })` against the no-props overload and rejects
// `rail`. Every field is already optional, so `<Sidebar />` still type-checks.
export const Sidebar = ({ variant = "desktop", rail: railProp }: SidebarProps) => {
  const sessionsQ = useSessions()
  const projectsQ = useProjects()
  const params = useParams({ strict: false }) as { id?: string }
  const activeShort = params.id
  const pathname = useLocation({ select: (l) => l.pathname })
  const activeProject = activeProjectId(pathname)
  // null = closed. { project: null } opens the modal for a project-less ("+ New
  // session") spawn that lands in the Default bucket; { project } targets a repo.
  const [spawn, setSpawn] = useState<{ project: Project | null } | null>(null)
  const [sessionMenu, setSessionMenu] = useState<SessionMenu | null>(null)
  const { pinnedIds, togglePin, reorderPin } = usePinnedProjects()
  const { isCollapsed, toggleCollapsed } = useCollapsedBuckets()
  // Whole-rail collapse (distinct from the per-bucket collapse above): hides
  // the desktop sidebar entirely so <main> gets the full width. This fallback
  // instance only ever backs the drawer variant, which never reads
  // `rail.value` — the desktop call site always passes its own via `railProp`.
  const ownRail = usePersistedFlag("pid:sidebar:rail-collapsed")
  const rail = railProp ?? ownRail
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

  // Collapsed (desktop only): render nothing at all — each page's top row shows
  // a small reopen chip instead (see sidebarRail.tsx) and <main> reclaims the
  // full width with no padding left over. Sits ahead of the loading branch so
  // the sidebar stays gone even while sessions/projects are still loading.
  if (rail.value && variant === "desktop") {
    return null
  }

  if (sessionsQ.isLoading || projectsQ.isLoading) {
    return <aside className={sidebarLoadingClass(variant)}>Loading…</aside>
  }

  const buckets = bucketProjects({
    projects: projectsQ.data ?? [],
    sessions: sessionsQ.data ?? [],
    pinnedIds,
  })
  const totalSessions = buckets.reduce((n, b) => n + b.sessions.length, 0)

  return (
    <aside data-testid="sidebar" className={sidebarAsideClass(variant)}>
      <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2.5 border-b border-base-300 bg-base-100/90 backdrop-blur">
        <Link
          to="/"
          data-testid="sidebar-projects-link"
          className="group inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-base-content/80 hover:text-primary"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 items-center justify-center rounded-btn bg-primary text-primary-content text-[11px] font-black shadow-sm shadow-primary/30 transition-transform group-hover:scale-105"
          >
            π
          </span>
          <span className="group-hover:underline">Projects</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-base-content/60">
            {buckets.length} · {totalSessions} session{totalSessions === 1 ? "" : "s"}
          </span>
          <NotifyToggle />
          <button
            type="button"
            data-testid="sidebar-new-session"
            onClick={() => setSpawn({ project: null })}
            title="Start a session not tied to a project (lands under Default)"
            aria-label="Start a session not tied to a project (lands under Default)"
            className="inline-flex h-6 w-6 items-center justify-center rounded-btn text-base-content/60 hover:bg-primary/15 hover:text-primary"
          >
            <span className="text-sm leading-none" aria-hidden>
              +
            </span>
          </button>
          {variant === "desktop" ? (
            <button
              type="button"
              data-testid="sidebar-rail-toggle"
              data-collapsed="false"
              onClick={rail.toggle}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="inline-flex h-6 w-6 items-center justify-center rounded-btn text-base-content/60 hover:bg-base-200 hover:text-base-content"
            >
              <span aria-hidden>«</span>
            </button>
          ) : null}
        </div>
      </div>
      <nav className="flex-1 py-1 divide-y divide-base-300">
        {buckets.length === 0 ? (
          <div className="px-3 py-4 text-xs text-base-content/60">No projects yet.</div>
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
                onSpawn={(project) => setSpawn({ project })}
                onShowMore={showMore}
                onSessionMenu={setSessionMenu}
              />
            )
          })
        )}
      </nav>
      <Link
        to="/"
        className="border-t border-base-300 px-3 py-2 text-[11px] text-base-content/60 hover:bg-base-200"
      >
        ← Back to project grid
      </Link>
      <SpawnModal
        open={spawn !== null}
        project={spawn?.project ?? null}
        onClose={() => setSpawn(null)}
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
