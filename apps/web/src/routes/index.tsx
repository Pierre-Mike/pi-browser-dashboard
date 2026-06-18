import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { ClaudeConfigPanel } from "../features/claude-config/ClaudeConfigPanel"
import { ExtensionHost } from "../features/extensions/ExtensionHost"
import { ExtensionsPanel } from "../features/extensions/ExtensionsPanel"
import { useExtensions } from "../features/extensions/useExtensions"
import { LibraryPanel } from "../features/library/LibraryPanel"
import { GlobalTerminal } from "../features/projects/GlobalTerminal"
import { OrchestrationPanel } from "../features/projects/OrchestrationPanel"
import { useProjects } from "../features/projects/useProjects"
import { RecentSessionsFeed } from "../features/sessions/RecentSessionsFeed"
import { useSessions } from "../features/sessions/useSessions"
import { TunnelPanel } from "../features/tunnel/TunnelPanel"
import { EXT_ICON, TAB_ICONS, tabButtonClass, tabDockNavClass } from "../lib/tabDock"
import { coerceExtTab } from "../lib/tabParams"

const STATIC_TAB_KEYS = [
  "terminal",
  "orchestration",
  "projects",
  "claude",
  "library",
  "extensions",
  "tunnel",
] as const
type StaticTabKey = (typeof STATIC_TAB_KEYS)[number]
// Extension tabs are namespaced (`ext:<name>`) so they can never collide
// with a static key.
type TabKey = StaticTabKey | `ext:${string}`

// Map each dashboard tab key onto a shared section icon (see lib/tabDock). The
// "projects" tab is labelled Activity, so it borrows the activity glyph.
const ICONS: Record<StaticTabKey, ReactNode> = {
  terminal: TAB_ICONS.terminal,
  orchestration: TAB_ICONS.orchestration,
  projects: TAB_ICONS.activity,
  claude: TAB_ICONS.claude,
  library: TAB_ICONS.library,
  extensions: TAB_ICONS.extensions,
  tunnel: TAB_ICONS.tunnel,
}

const TABS: readonly { key: StaticTabKey; label: string }[] = [
  { key: "terminal", label: "Terminal" },
  // Orchestration is global by design: one voice supervisor coordinates work
  // across ALL projects, so it lives on the root dashboard, not per-project.
  { key: "orchestration", label: "Orchestration" },
  { key: "projects", label: "Activity" },
  { key: "claude", label: "Claude" },
  { key: "library", label: "Library" },
  { key: "extensions", label: "Extensions" },
  { key: "tunnel", label: "Tunnel" },
]

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { tab?: TabKey } => {
    const tab = coerceExtTab(search.tab, STATIC_TAB_KEYS)
    return tab === undefined ? {} : { tab }
  },
  component: IndexPage,
})

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
      <div className="card border border-slate-200/80 dark:border-slate-800 bg-base-200/50 shadow-sm">
        <div className="card-body items-center gap-3 py-10 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-content text-xl font-black shadow-sm shadow-primary/30">
            π
          </span>
          <h2 className="card-title text-base">Welcome home</h2>
          <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
            No projects or sessions yet. Spawn your first one from{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">+ New session</span> in
            the sidebar, or open the Terminal tab to get going.
          </p>
        </div>
      </div>
    )
  }
  return <RecentSessionsFeed projects={projects} sessions={sessions} />
}

function IndexPage() {
  const { tab = "terminal" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const setTab = (next: TabKey) => navigate({ search: (prev) => ({ ...prev, tab: next }) })
  const extensionsQ = useExtensions()
  // Only iframe-tier extensions that contribute a top-level tab.
  // Only enabled iframe-tier extensions that contribute a top-level tab.
  const extTabs = (extensionsQ.data ?? []).filter(
    (e) => e.enabled !== false && e.tier === "iframe" && (e.contributes?.tabs?.length ?? 0) > 0,
  )
  const fillViewport =
    tab === "terminal" ||
    tab === "orchestration" ||
    tab === "claude" ||
    tab === "library" ||
    tab.startsWith("ext:")

  return (
    <div
      data-testid="dashboard"
      className={`flex flex-col gap-4 ${fillViewport ? "h-screen -my-4 pt-4" : ""}`}
    >
      <nav
        data-testid="dashboard-tabs"
        role="tablist"
        aria-label="Dashboard sections"
        className={tabDockNavClass}
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
              className={tabButtonClass(active)}
            >
              {ICONS[t.key]}
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
              className={tabButtonClass(active)}
            >
              {EXT_ICON}
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
        data-testid="dashboard-tab-panel-orchestration"
        className={tab === "orchestration" ? "flex flex-col flex-1 min-h-0" : "hidden"}
      >
        {/* Mount only when active: TerminalView opens its WS on mount, attaching
            (and on first open booting) the machine-wide "Orchestrator" session.
            Lazy mount keeps the supervisor from booting on every dashboard load. */}
        {tab === "orchestration" ? <OrchestrationPanel /> : null}
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

      <div
        role="tabpanel"
        data-testid="dashboard-tab-panel-extensions"
        className={tab === "extensions" ? "flex flex-col gap-3" : "hidden"}
      >
        <ExtensionsPanel />
      </div>

      <div
        role="tabpanel"
        data-testid="dashboard-tab-panel-tunnel"
        className={tab === "tunnel" ? "flex flex-col gap-3" : "hidden"}
      >
        <TunnelPanel />
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
