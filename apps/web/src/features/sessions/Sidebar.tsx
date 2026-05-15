import { Link, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { cwdTail, stateColor } from "../../lib/format"
import type { Project, SessionState } from "../../lib/types"
import { SpawnModal } from "../dispatch/SpawnModal"
import { useProjects } from "../projects/useProjects"
import { useSessions } from "./useSessions"

type Bucket = {
  key: string
  title: string
  pathHint: string
  sessions: SessionState[]
  project: Project | null
}

const bucket = (
  projects: readonly Project[],
  sessions: readonly SessionState[],
): readonly Bucket[] => {
  const byPath = new Map<string, Project>()
  for (const p of projects) byPath.set(p.path, p)

  const byKey = new Map<string, Bucket>()
  for (const p of projects) {
    byKey.set(`p:${p.id}`, {
      key: `p:${p.id}`,
      title: p.isGitRepo ? p.name : `⚠ ${p.name}`,
      pathHint: p.path,
      sessions: [],
      project: p,
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
      })
    }
  }

  const out = [...byKey.values()]
  out.sort((a, b) => {
    if (a.sessions.length !== b.sessions.length) return b.sessions.length - a.sessions.length
    return a.title.localeCompare(b.title)
  })
  return out
}

const labelFor = (s: SessionState): string => s.name?.trim() || s.short

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

  const buckets = bucket(projectsQ.data ?? [], sessionsQ.data ?? [])

  return (
    <aside
      data-testid="sidebar"
      className="hidden md:flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 h-[calc(100vh-49px)] sticky top-[49px] overflow-y-auto"
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
        Projects
      </div>
      <nav className="flex-1 py-1.5">
        {buckets.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500">No projects yet.</div>
        ) : (
          buckets.map((b) => (
            <div key={b.key} className="px-1.5 py-1">
              <div
                className="group flex items-center gap-1 px-2 py-1 text-[12px] font-medium text-slate-700 dark:text-slate-200"
                title={b.pathHint}
              >
                {b.project ? (
                  <Link
                    to="/projects/$id"
                    params={{ id: b.project.id }}
                    data-testid="sidebar-project-link"
                    data-project-id={b.project.id}
                    className="truncate flex-1 hover:text-sky-700 dark:hover:text-sky-300 hover:underline"
                  >
                    {b.title}
                    <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">
                      {b.sessions.length}
                    </span>
                  </Link>
                ) : (
                  <span className="truncate flex-1">
                    {b.title}
                    <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">
                      {b.sessions.length}
                    </span>
                  </span>
                )}
                {b.project ? (
                  <button
                    type="button"
                    onClick={() => setSpawnProject(b.project)}
                    data-testid="sidebar-spawn"
                    data-project-id={b.project.id}
                    title={`Spawn a new session in ${b.title}`}
                    aria-label={`Spawn a new session in ${b.title}`}
                    className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-sm leading-none text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40"
                  >
                    +
                  </button>
                ) : null}
              </div>
              {b.sessions.length > 0 ? (
                <ul className="flex flex-col">
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
                          className={`flex items-center gap-2 px-2 py-1 mx-0.5 rounded text-xs ${
                            active
                              ? "bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-100"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
                          }`}
                          title={s.detail}
                        >
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`}
                            aria-hidden
                          />
                          <span className="truncate flex-1">{labelFor(s)}</span>
                          <span className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500 shrink-0">
                            {tone.label}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          ))
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
