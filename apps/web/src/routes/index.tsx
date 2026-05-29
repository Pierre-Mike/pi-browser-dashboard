import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ClaudeConfigPanel } from "../features/claude-config/ClaudeConfigPanel"
import { LibraryPanel } from "../features/library/LibraryPanel"
import { GlobalTerminal } from "../features/projects/GlobalTerminal"
import { useProjects } from "../features/projects/useProjects"
import { ProjectGrid } from "../features/sessions/ProjectGrid"
import { useSessions } from "../features/sessions/useSessions"

export const Route = createFileRoute("/")({
  component: IndexPage,
})

type TabKey = "projects" | "terminal" | "claude" | "library"
type Tab = { readonly key: TabKey; readonly label: string }

const TABS: readonly Tab[] = [
  { key: "terminal", label: "Terminal" },
  { key: "projects", label: "Projects" },
  { key: "claude", label: "Claude" },
  { key: "library", label: "Library" },
]

const ProjectsPanel = () => {
  const sessionsQ = useSessions()
  const projectsQ = useProjects()

  if (sessionsQ.isLoading || projectsQ.isLoading) {
    return <div className="text-sm text-slate-500">Loading…</div>
  }
  if (sessionsQ.isError) {
    return (
      <div className="text-sm text-rose-600">
        Failed to load sessions:{" "}
        {sessionsQ.error instanceof Error ? sessionsQ.error.message : "unknown error"}
      </div>
    )
  }
  if (projectsQ.isError) {
    return (
      <div className="text-sm text-rose-600">
        Failed to load projects:{" "}
        {projectsQ.error instanceof Error ? projectsQ.error.message : "unknown error"}
      </div>
    )
  }
  const sessions = sessionsQ.data ?? []
  const projects = projectsQ.data ?? []
  if (sessions.length === 0 && projects.length === 0) {
    return (
      <div className="text-sm text-slate-500">
        No projects or sessions yet. Spawn one from the bar above.
      </div>
    )
  }
  return <ProjectGrid projects={projects} sessions={sessions} />
}

function IndexPage() {
  const [tab, setTab] = useState<TabKey>("terminal")
  const fillViewport = tab === "terminal" || tab === "claude" || tab === "library"

  return (
    <div
      data-testid="dashboard"
      className={`flex flex-col gap-4 ${fillViewport ? "h-screen -my-4 pt-4" : ""}`}
    >
      <nav
        data-testid="dashboard-tabs"
        role="tablist"
        aria-label="Dashboard sections"
        className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800"
      >
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`dashboard-tab-${t.key}`}
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
        data-testid="dashboard-tab-panel-projects"
        className={tab === "projects" ? "flex flex-col gap-3" : "hidden"}
      >
        <ProjectsPanel />
      </div>

      <div
        role="tabpanel"
        data-testid="dashboard-tab-panel-terminal"
        className={tab === "terminal" ? "flex flex-col flex-1 min-h-0" : "hidden"}
      >
        <GlobalTerminal />
      </div>

      <div
        role="tabpanel"
        data-testid="dashboard-tab-panel-claude"
        className={tab === "claude" ? "flex flex-col flex-1 min-h-0 gap-2" : "hidden"}
      >
        <ClaudeConfigPanel scope="global" />
      </div>

      <div
        role="tabpanel"
        data-testid="dashboard-tab-panel-library"
        className={tab === "library" ? "flex flex-col flex-1 min-h-0 gap-2" : "hidden"}
      >
        <LibraryPanel scope="global" />
      </div>
    </div>
  )
}
