import { getRouteApi, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { EXT_ICON, TAB_ICONS, tabButtonClass, tabDockNavClass } from "../../lib/tabDock"
import type { Project, SessionState, SessionStateValue } from "../../lib/types"
import { ClaudeConfigPanel } from "../claude-config/ClaudeConfigPanel"
import { SpawnModal } from "../dispatch/SpawnModal"
import { ExtensionHost } from "../extensions/ExtensionHost"
import { useExtensions } from "../extensions/useExtensions"
import { LibraryPanel } from "../library/LibraryPanel"
import { PidSettingsPanel } from "../pid-settings/PidSettingsPanel"
import { RecentSessionsFeed } from "../sessions/RecentSessionsFeed"
import { useSessions } from "../sessions/useSessions"
import { FileTree } from "./FileTree"
import { GithubPanel } from "./GithubPanel"
import { ProjectTerminal } from "./ProjectTerminal"

const route = getRouteApi("/projects/$id")

type Props = { project: Project }

type Counts = Record<SessionStateValue, number>

type StaticTabKey = "sessions" | "github" | "terminal" | "files" | "claude" | "library" | "settings"
// Extension-contributed project panels are namespaced (`ext:<name>`).
type TabKey = StaticTabKey | `ext:${string}`

type Tab = { readonly key: TabKey; readonly label: string }

// Each project tab borrows the shared section glyph (see lib/tabDock) so a
// "Terminal" / "Claude" / "Library" tab looks identical to the root dashboard.
const projectTabIcon = (key: TabKey) => {
  if (key.startsWith("ext:")) return EXT_ICON
  if (key === "sessions") return TAB_ICONS.activity
  return TAB_ICONS[key] ?? null
}

const emptyCounts = (): Counts => ({
  blocked: 0,
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
  const extensionsQ = useExtensions()
  const [spawnOpen, setSpawnOpen] = useState(false)
  const sessions = (sessionsQ.data ?? []).filter((s) => s.cwd === project.path)
  const counts = tally(sessions)

  // Only enabled iframe-tier extensions that contribute a project panel.
  const extPanels = (extensionsQ.data ?? []).filter(
    (e) =>
      e.enabled !== false && e.tier === "iframe" && (e.contributes?.projectPanels?.length ?? 0) > 0,
  )

  const tabs: readonly Tab[] = useMemo(() => {
    const base: Tab[] = [
      { key: "terminal", label: "Terminal" },
      { key: "sessions", label: `Activity${sessions.length ? ` · ${sessions.length}` : ""}` },
    ]
    if (project.githubUrl) base.push({ key: "github", label: "GitHub" })
    base.push({ key: "files", label: "Files" })
    base.push({ key: "claude", label: "Claude" })
    base.push({ key: "library", label: "Library" })
    base.push({ key: "settings", label: "Settings" })
    for (const e of extPanels) base.push({ key: `ext:${e.name}`, label: e.name })
    return base
  }, [project.githubUrl, sessions.length, extPanels])

  const { tab = "terminal" } = route.useSearch()
  const navigate = route.useNavigate()
  const setTab = (next: TabKey) => navigate({ search: (prev) => ({ ...prev, tab: next }) })
  const fillViewport =
    tab === "terminal" || tab === "files" || tab === "claude" || tab === "library"

  return (
    <div
      data-testid="project-dashboard"
      className={`flex flex-col gap-1 ${fillViewport ? "h-screen -my-4 pt-1" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link
          to="/"
          className="text-[11px] text-slate-500 dark:text-slate-400 hover:underline shrink-0"
          title="All projects"
        >
          ←
        </Link>
        <h1 className="text-sm font-semibold flex items-center gap-1.5 min-w-0">
          <span className="truncate">{project.name}</span>
          {project.isGitRepo ? null : (
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
              className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] px-1.5 py-0.5 max-w-[200px] truncate"
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
        <span
          className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate min-w-0 flex-1"
          title={project.path}
        >
          {project.path}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {counts.working > 0 ? (
            <Pill
              label="working"
              value={counts.working}
              tone="bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200"
            />
          ) : null}
          {counts.blocked > 0 ? (
            <Pill
              label="blocked"
              value={counts.blocked}
              tone="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
            />
          ) : null}
          {counts.needs_input > 0 ? (
            <Pill
              label="needs input"
              value={counts.needs_input}
              tone="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
            />
          ) : null}
          {counts.failed > 0 ? (
            <Pill
              label="failed"
              value={counts.failed}
              tone="bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200"
            />
          ) : null}
        </div>
        <button
          type="button"
          data-testid="dashboard-spawn"
          onClick={() => setSpawnOpen(true)}
          className="btn btn-primary btn-xs gap-1 normal-case shrink-0 shadow-sm shadow-primary/30"
        >
          Spawn +
        </button>
      </header>

      <nav
        data-testid="project-tabs"
        role="tablist"
        aria-label="Project sections"
        className={tabDockNavClass}
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
              className={tabButtonClass(active)}
            >
              {projectTabIcon(t.key)}
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
          <div className="card border border-dashed border-slate-300 dark:border-slate-800 bg-base-200/40">
            <div className="card-body items-center gap-1 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No sessions yet — use{" "}
              <span className="font-medium text-slate-700 dark:text-slate-200">Spawn +</span> to
              start one.
            </div>
          </div>
        ) : (
          <RecentSessionsFeed
            projects={[project]}
            sessions={sessions}
            showProjectName={false}
            limit={Number.POSITIVE_INFINITY}
          />
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
        className={tab === "terminal" ? "flex flex-col flex-1 min-h-0" : "hidden"}
      >
        <ProjectTerminal projectId={project.id} />
      </div>

      <div
        role="tabpanel"
        data-testid="project-tab-panel-files"
        className={tab === "files" ? "flex flex-col flex-1 min-h-0" : "hidden"}
      >
        <FileTree projectId={project.id} />
      </div>

      <div
        role="tabpanel"
        data-testid="project-tab-panel-claude"
        className={tab === "claude" ? "flex flex-col flex-1 min-h-0 gap-2" : "hidden"}
      >
        <ClaudeConfigPanel scope="project" projectId={project.id} />
      </div>

      <div
        role="tabpanel"
        data-testid="project-tab-panel-library"
        className={tab === "library" ? "flex flex-col flex-1 min-h-0" : "hidden"}
      >
        <LibraryPanel scope="project" projectId={project.id} />
      </div>

      <div
        role="tabpanel"
        data-testid="project-tab-panel-settings"
        className={tab === "settings" ? "flex flex-col gap-3" : "hidden"}
      >
        <PidSettingsPanel projectId={project.id} />
      </div>

      {extPanels.map((e) => {
        const key: TabKey = `ext:${e.name}`
        return (
          <div
            key={key}
            role="tabpanel"
            data-testid={`project-tab-panel-ext-${e.name}`}
            className={tab === key ? "flex flex-col flex-1 min-h-0" : "hidden"}
          >
            <ExtensionHost manifest={e} projectId={project.id} cwd={project.path} />
          </div>
        )
      })}

      <SpawnModal open={spawnOpen} project={project} onClose={() => setSpawnOpen(false)} />
    </div>
  )
}
