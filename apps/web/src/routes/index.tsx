import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ClaudeConfigPanel } from "../features/claude-config/ClaudeConfigPanel"
import { ExtensionHost } from "../features/extensions/ExtensionHost"
import { useExtensions } from "../features/extensions/useExtensions"
import { LibraryPanel } from "../features/library/LibraryPanel"
import { GlobalTerminal } from "../features/projects/GlobalTerminal"
import { useProjects } from "../features/projects/useProjects"
import { ProjectGrid } from "../features/sessions/ProjectGrid"
import { useSessions } from "../features/sessions/useSessions"

export const Route = createFileRoute("/")({
  component: IndexPage,
})

type StaticTabKey = "projects" | "terminal" | "claude" | "library"
// Extension tabs are namespaced (`ext:<name>`) so they can never collide
// with a static key.
type TabKey = StaticTabKey | `ext:${string}`

const TABS: readonly { key: StaticTabKey; label: string }[] = [
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
  const extensionsQ = useExtensions()
  // Only iframe-tier extensions that contribute a top-level tab.
  const extTabs = (extensionsQ.data ?? []).filter(
    (e) => e.tier === "iframe" && (e.contributes?.tabs?.length ?? 0) > 0,
  )
  const fillViewport =
    tab === "terminal" || tab === "claude" || tab === "library" || tab.startsWith("ext:")

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
        {extTabs.map((e) => {
          const key: TabKey = `ext:${e.name}`
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`dashboard-tab-ext-${e.name}`}
              data-active={active}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? "border-sky-500 text-sky-700 dark:text-sky-300"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {e.name}
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

      {extTabs.map((e) => {
        const key: TabKey = `ext:${e.name}`
        return (
          <div
            key={key}
            role="tabpanel"
            data-testid={`dashboard-tab-panel-ext-${e.name}`}
            className={tab === key ? "flex flex-col flex-1 min-h-0" : "hidden"}
          >
            <ExtensionHost manifest={e} />
          </div>
        )
      })}
    </div>
  )
}
