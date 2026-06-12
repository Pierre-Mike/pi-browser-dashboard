import { Link, useLocation, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { stateColor, stateTitle } from "../../lib/format"
import type { Project } from "../../lib/types"
import { SpawnModal } from "../dispatch/SpawnModal"
import { NotifyToggle } from "../notifications/NotifyToggle"
import { useProjects } from "../projects/useProjects"
import { clampMenuPosition } from "./contextMenu"
import { MENU_HEIGHT, MENU_WIDTH, SessionContextMenu } from "./SessionContextMenu"
import {
  activeProjectId,
  bucketProjects,
  growLimit,
  SESSION_PAGE_SIZE,
  sessionLabel,
  sessionMoreLabel,
  sessionWindow,
} from "./sidebarUtil"
import { useCollapsedBuckets } from "./useCollapsedBuckets"
import { usePinnedProjects } from "./usePinnedProjects"
import { useSessions } from "./useSessions"

type SessionMenu = { short: string; x: number; y: number }

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
  const endPinDrag = () => {
    setDragPinId(null)
    setOverPinId(null)
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
            const isNonGit = b.project !== null && !b.project.isGitRepo
            const collapsed = isCollapsed(b.key)
            const projectActive = b.project !== null && b.project.id === activeProject
            const { visible, hiddenCount } = sessionWindow({
              sessions: b.sessions,
              limit: sessionLimits[b.key] ?? SESSION_PAGE_SIZE,
            })
            return (
              <div key={b.key} className="px-1.5 py-1.5">
                <div
                  data-testid="sidebar-bucket-row"
                  data-project-id={b.project?.id}
                  data-drop-target={
                    b.pinned && dragPinId && dragPinId !== b.project?.id ? "true" : "false"
                  }
                  onDragOver={(e) => {
                    // Only pinned rows accept a drop, and never onto self.
                    if (!b.pinned || !b.project || !dragPinId || dragPinId === b.project.id) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                    if (overPinId !== b.project.id) setOverPinId(b.project.id)
                  }}
                  onDragLeave={() => {
                    if (b.project && overPinId === b.project.id) setOverPinId(null)
                  }}
                  onDrop={(e) => {
                    if (!b.pinned || !b.project || !dragPinId) return
                    e.preventDefault()
                    reorderPin(dragPinId, b.project.id)
                    endPinDrag()
                  }}
                  className={`group flex items-center gap-1.5 px-1.5 py-1 rounded ${
                    overPinId === b.project?.id && dragPinId && dragPinId !== b.project?.id
                      ? "shadow-[inset_0_2px_0_0] shadow-amber-500"
                      : ""
                  } ${
                    projectActive
                      ? "bg-sky-100 dark:bg-sky-900/50 shadow-[inset_2px_0_0_0] shadow-sky-500"
                      : "hover:bg-slate-50 dark:hover:bg-slate-900/60"
                  } ${dragPinId === b.project?.id ? "opacity-40" : ""}`}
                  title={b.pathHint}
                >
                  {b.pinned && b.project ? (
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        if (!b.project) return
                        e.dataTransfer.effectAllowed = "move"
                        // Some browsers require data to be set for drag to fire.
                        e.dataTransfer.setData("text/plain", b.project.id)
                        setDragPinId(b.project.id)
                      }}
                      onDragEnd={endPinDrag}
                      data-testid="sidebar-pin-drag-handle"
                      data-project-id={b.project.id}
                      title={`Drag to reorder ${b.title}`}
                      aria-label={`Drag to reorder ${b.title}`}
                      className="shrink-0 inline-flex items-center justify-center w-3 h-4 cursor-grab active:cursor-grabbing text-[10px] leading-none text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                      ⠿
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(b.key)}
                    data-testid="sidebar-collapse-toggle"
                    data-bucket-key={b.key}
                    data-collapsed={collapsed ? "true" : "false"}
                    aria-expanded={!collapsed}
                    title={
                      collapsed ? `Show sessions in ${b.title}` : `Hide sessions in ${b.title}`
                    }
                    aria-label={
                      collapsed ? `Show sessions in ${b.title}` : `Hide sessions in ${b.title}`
                    }
                    className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded text-[9px] leading-none text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-transform duration-200 ${
                      collapsed ? "-rotate-90" : ""
                    }`}
                  >
                    ▼
                  </button>
                  {b.project ? (
                    <Link
                      to="/projects/$id"
                      params={{ id: b.project.id }}
                      data-testid="sidebar-project-link"
                      data-project-id={b.project.id}
                      data-pinned={b.pinned ? "true" : "false"}
                      data-active={projectActive ? "true" : "false"}
                      className={`truncate flex-1 inline-flex items-center gap-1.5 text-[13px] font-semibold ${
                        projectActive
                          ? "text-sky-900 dark:text-sky-100"
                          : "text-slate-800 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-300"
                      }`}
                    >
                      {isNonGit ? (
                        <span
                          title="Not a git repository"
                          aria-label="Not a git repository"
                          className="text-amber-500 text-[11px] leading-none"
                        >
                          ⚠
                        </span>
                      ) : null}
                      <span className="truncate">{b.title}</span>
                      {b.project.branch ? (
                        <span
                          data-testid="sidebar-project-branch"
                          data-branch={b.project.branch}
                          title={`branch: ${b.project.branch}`}
                          className="shrink-0 max-w-[80px] truncate font-mono text-[10px] font-normal text-slate-500 dark:text-slate-400"
                        >
                          {b.project.branch}
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="truncate flex-1 inline-flex items-center gap-1.5 text-[12px] font-medium italic text-slate-500 dark:text-slate-400">
                      <span
                        title="No matching project"
                        aria-label="No matching project"
                        className="text-[9px] uppercase tracking-wide px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500"
                      >
                        orphan
                      </span>
                      <span className="truncate">{b.title}</span>
                    </span>
                  )}
                  <span
                    className={`shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] tabular-nums font-medium ${
                      b.sessions.length > 0
                        ? "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                    }`}
                    aria-label={`${b.sessions.length} sessions`}
                  >
                    {b.sessions.length}
                  </span>
                  {b.project ? (
                    <button
                      type="button"
                      onClick={() => b.project && togglePin(b.project.id)}
                      data-testid="sidebar-pin-toggle"
                      data-project-id={b.project.id}
                      data-pinned={b.pinned ? "true" : "false"}
                      title={b.pinned ? `Unpin ${b.title}` : `Pin ${b.title} to top`}
                      aria-label={b.pinned ? `Unpin ${b.title}` : `Pin ${b.title} to top`}
                      aria-pressed={b.pinned}
                      className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[11px] leading-none ${
                        b.pinned
                          ? "text-amber-500 dark:text-amber-400"
                          : "text-slate-300 dark:text-slate-600 hover:text-amber-500 dark:hover:text-amber-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      }`}
                    >
                      {b.pinned ? "★" : "☆"}
                    </button>
                  ) : null}
                  {b.project ? (
                    <button
                      type="button"
                      onClick={() => setSpawnProject(b.project)}
                      data-testid="sidebar-spawn"
                      data-project-id={b.project.id}
                      title={`Spawn a new session in ${b.title}`}
                      aria-label={`Spawn a new session in ${b.title}`}
                      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-sm leading-none text-slate-400 hover:text-sky-600 dark:text-slate-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 opacity-60 group-hover:opacity-100 focus:opacity-100"
                    >
                      +
                    </button>
                  ) : null}
                </div>
                {b.sessions.length > 0 ? (
                  <div
                    data-testid="sidebar-session-list"
                    data-bucket-key={b.key}
                    data-collapsed={collapsed ? "true" : "false"}
                    // grid-rows 1fr→0fr is the pure-CSS slide: the inner
                    // min-h-0 row shrinks to nothing and back, animated.
                    className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
                      collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                    }`}
                  >
                    <ul
                      className={`min-h-0 overflow-hidden mt-0.5 ml-3.5 pl-2 border-l border-slate-200 dark:border-slate-800 flex flex-col gap-px ${
                        collapsed ? "invisible" : ""
                      }`}
                    >
                      {visible.map((s) => {
                        const tone = stateColor(s.state)
                        const active = s.short === activeShort
                        return (
                          <li key={s.short}>
                            <Link
                              to="/sessions/$id"
                              params={{ id: s.short }}
                              data-testid="sidebar-session"
                              data-short={s.short}
                              data-active={active ? "true" : "false"}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setSessionMenu({
                                  short: s.short,
                                  ...clampMenuPosition({
                                    x: e.clientX,
                                    y: e.clientY,
                                    menuWidth: MENU_WIDTH,
                                    menuHeight: MENU_HEIGHT,
                                    viewportWidth: window.innerWidth,
                                    viewportHeight: window.innerHeight,
                                  }),
                                })
                              }}
                              // Status reads as colour, not a text badge: the
                              // name is tinted by state and a matching dot leads
                              // the row. Hover (title) spells the status out.
                              className={`relative flex items-center gap-2 pl-2 pr-1.5 py-1 rounded text-[11.5px] leading-tight ${
                                active
                                  ? "bg-sky-100 dark:bg-sky-900/50 text-sky-900 dark:text-sky-100 font-medium shadow-[inset_2px_0_0_0] shadow-sky-500"
                                  : `${tone.text} hover:bg-slate-50 dark:hover:bg-slate-900/60`
                              }`}
                              title={stateTitle(s.state, s.detail)}
                            >
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`}
                                aria-hidden
                              />
                              <span className="truncate flex-1">{sessionLabel(s)}</span>
                            </Link>
                          </li>
                        )
                      })}
                      {hiddenCount > 0 ? (
                        <li>
                          <button
                            type="button"
                            onClick={() => showMore(b.key)}
                            data-testid="sidebar-session-more"
                            data-bucket-key={b.key}
                            data-hidden-count={hiddenCount}
                            className="w-full text-left pl-2 pr-1.5 py-1 rounded text-[11px] leading-tight text-slate-400 dark:text-slate-500 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-slate-50 dark:hover:bg-slate-900/60"
                          >
                            {sessionMoreLabel(hiddenCount)}
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>
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
