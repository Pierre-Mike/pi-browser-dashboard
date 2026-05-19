import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import type { Project, SessionState, SessionStateValue } from "../../lib/types"
import { SpawnModal } from "../dispatch/SpawnModal"
import { SessionCard } from "../sessions/SessionCard"
import { useSessions } from "../sessions/useSessions"
import { FileTree } from "./FileTree"
import { GithubPanel } from "./GithubPanel"
import { ProjectTerminal } from "./ProjectTerminal"

type Props = { project: Project }

type Counts = Record<SessionStateValue, number>

type TabKey = "sessions" | "github" | "terminal" | "files"

type Tab = { readonly key: TabKey; readonly label: string }

const emptyCounts = (): Counts => ({
  needs_input: 0,
  working: 0,
  idle: 0,
  done: 0,
  failed: 0,
  stopped: 0,
})

const tally = (sessions: readonly SessionState[]): Counts => {
  const c = emptyCounts()
  for (const s of sessions) c[s.state] += 1
  return c
}

const Pill = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
  >
    <span className="font-mono tabular-nums">{value}</span>
    <span className="opacity-80">{label}</span>
  </span>
)

export const ProjectDashboard = ({ project }: Props) => {
  const sessionsQ = useSessions()
  const [spawnOpen, setSpawnOpen] = useState(false)
  const sessions = (sessionsQ.data ?? []).filter((s) => s.cwd === project.path)
  const counts = tally(sessions)

  const tabs: readonly Tab[] = useMemo(() => {
    const base: Tab[] = [
      { key: "sessions", label: `Sessions${sessions.length ? ` · ${sessions.length}` : ""}` },
    ]
    if (project.githubUrl) base.push({ key: "github", label: "GitHub" })
    base.push({ key: "terminal", label: "Terminal" })
    base.push({ key: "files", label: "Files" })
    return base
  }, [project.githubUrl, sessions.length])

  const [tab, setTab] = useState<TabKey>("sessions")

  return (
    <div data-testid="project-dashboard" className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to="/"
          className="text-xs text-slate-500 dark:text-slate-400 hover:underline shrink-0"
          title="All projects"
        >
          ←
        </Link>
        <h1 className="text-sm font-semibold flex items-center gap-1.5 min-w-0">
          <span className="truncate" title={project.path}>
            {project.name}
          </span>
          {project.isGitRepo ? (
            <span className="text-[10px] uppercase tracking-wide rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5">
              git
            </span>
          ) : (
            <span
              className="text-[10px] uppercase tracking-wide rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5"
              title="No git → supervisor cannot isolate worktrees; siblings race on disk"
            >
              ⚠ no isolation
            </span>
          )}
          {project.branch ? (
            <span
              data-testid="project-dashboard-branch"
              data-branch={project.branch}
              title={`current branch: ${project.branch}`}
              className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] px-1.5 py-0.5 max-w-[160px] truncate"
            >
              <span aria-hidden>⎇</span>
              {project.branch}
            </span>
          ) : null}
          {project.githubUrl ? (
            <a
              data-testid="github-link"
              href={project.githubUrl}
              target="_blank"
              rel="noreferrer"
              title={`${project.githubOwner}/${project.githubRepo} on GitHub`}
              className="text-[10px] uppercase tracking-wide rounded bg-slate-900 text-slate-50 dark:bg-slate-100 dark:text-slate-900 px-1.5 py-0.5 hover:opacity-80"
            >
              GitHub ↗
            </a>
          ) : null}
        </h1>
        <div className="flex flex-wrap items-center gap-1">
          <Pill
            label="total"
            value={sessions.length}
            tone="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          />
          {counts.working > 0 ? (
            <Pill
              label="working"
              value={counts.working}
              tone="bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200"
            />
          ) : null}
          {counts.needs_input > 0 ? (
            <Pill
              label="needs input"
              value={counts.needs_input}
              tone="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
            />
          ) : null}
          {counts.idle > 0 ? (
            <Pill
              label="idle"
              value={counts.idle}
              tone="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            />
          ) : null}
          {counts.done > 0 ? (
            <Pill
              label="done"
              value={counts.done}
              tone="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200"
            />
          ) : null}
          {counts.failed > 0 ? (
            <Pill
              label="failed"
              value={counts.failed}
              tone="bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200"
            />
          ) : null}
          {counts.stopped > 0 ? (
            <Pill
              label="stopped"
              value={counts.stopped}
              tone="bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200"
            />
          ) : null}
        </div>
        <button
          type="button"
          data-testid="dashboard-spawn"
          onClick={() => setSpawnOpen(true)}
          className="ml-auto text-xs font-medium rounded-md border border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 px-2 py-0.5 hover:bg-sky-100 dark:hover:bg-sky-900/50"
        >
          Spawn +
        </button>
      </header>

      <nav
        data-testid="project-tabs"
        role="tablist"
        aria-label="Project sections"
        className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800"
      >
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`project-tab-${t.key}`}
              data-active={active}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? "border-sky-500 text-sky-700 dark:text-sky-300"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </nav>

      <div
        role="tabpanel"
        data-testid="project-tab-panel-sessions"
        className={tab === "sessions" ? "flex flex-col gap-3" : "hidden"}
      >
        {sessions.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-lg">
            No sessions yet — use <span className="font-medium">Spawn new +</span> to start one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sessions.map((s) => (
              <SessionCard key={s.short} session={s} />
            ))}
          </div>
        )}
      </div>

      {project.githubUrl ? (
        <div
          role="tabpanel"
          data-testid="project-tab-panel-github"
          className={tab === "github" ? "" : "hidden"}
        >
          <GithubPanel projectId={project.id} githubUrl={project.githubUrl} />
        </div>
      ) : null}

      <div
        role="tabpanel"
        data-testid="project-tab-panel-terminal"
        className={tab === "terminal" ? "" : "hidden"}
      >
        <ProjectTerminal projectId={project.id} projectName={project.name} />
      </div>

      <div
        role="tabpanel"
        data-testid="project-tab-panel-files"
        className={tab === "files" ? "flex flex-col gap-2" : "hidden"}
      >
        <FileTree projectId={project.id} />
      </div>

      <SpawnModal open={spawnOpen} project={project} onClose={() => setSpawnOpen(false)} />
    </div>
  )
}
