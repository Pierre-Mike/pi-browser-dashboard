import { Link, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { stateColor } from "../../lib/format"
import type { Project } from "../../lib/types"
import { SpawnModal } from "../dispatch/SpawnModal"
import { useProjects } from "../projects/useProjects"
import { bucketProjects, sessionLabel } from "./sidebarUtil"
import { useSessions } from "./useSessions"

export const Sidebar = () => {
  const sessionsQ = useSessions()
  const projectsQ = useProjects()
  const params = useParams({ strict: false }) as { id?: string }
  const activeShort = params.id
  const [spawnProject, setSpawnProject] = useState<Project | null>(null)

  if (sessionsQ.isLoading || projectsQ.isLoading) {
    return (
      <aside className="hidden md:block w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-500">
        Loading…
      </aside>
    )
  }

  const buckets = bucketProjects(projectsQ.data ?? [], sessionsQ.data ?? [])
  const totalSessions = buckets.reduce((n, b) => n + b.sessions.length, 0)

  return (
    <aside
      data-testid="sidebar"
      className="hidden md:flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-[calc(100vh-49px)] sticky top-[49px] overflow-y-auto"
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          Projects
        </span>
        <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          {buckets.length} · {totalSessions} session{totalSessions === 1 ? "" : "s"}
        </span>
      </div>
      <nav className="flex-1 py-1 divide-y divide-slate-100 dark:divide-slate-900/70">
        {buckets.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500">No projects yet.</div>
        ) : (
          buckets.map((b) => {
            const isNonGit = b.project !== null && !b.project.isGitRepo
            return (
              <div key={b.key} className="px-1.5 py-1.5">
                <div
                  className="group flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-900/60"
                  title={b.pathHint}
                >
                  {b.project ? (
                    <Link
                      to="/projects/$id"
                      params={{ id: b.project.id }}
                      data-testid="sidebar-project-link"
                      data-project-id={b.project.id}
                      className="truncate flex-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-300"
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
                  <ul className="mt-0.5 ml-3.5 pl-2 border-l border-slate-200 dark:border-slate-800 flex flex-col gap-px">
                    {b.sessions.map((s) => {
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
                            className={`relative flex items-center gap-2 pl-2 pr-1.5 py-1 rounded text-[11.5px] leading-tight ${
                              active
                                ? "bg-sky-100 dark:bg-sky-900/50 text-sky-900 dark:text-sky-100 font-medium shadow-[inset_2px_0_0_0] shadow-sky-500"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/60"
                            }`}
                            title={s.detail}
                          >
                            <span
                              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`}
                              aria-hidden
                            />
                            <span className="truncate flex-1">{sessionLabel(s)}</span>
                            <span
                              className={`text-[9px] uppercase tracking-wide shrink-0 ${
                                active
                                  ? "text-sky-700 dark:text-sky-300"
                                  : "text-slate-400 dark:text-slate-500"
                              }`}
                            >
                              {tone.label}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div
                    className="ml-3.5 pl-2 border-l border-slate-200 dark:border-slate-800 py-0.5 text-[10.5px] italic text-slate-400 dark:text-slate-600"
                    aria-hidden
                  >
                    no sessions
                  </div>
                )}
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
    </aside>
  )
}
