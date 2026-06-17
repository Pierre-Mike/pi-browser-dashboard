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

// A small inline icon set keeps the nav glanceable — colour + shape lets the
// eye land on the right section without reading every label. No icon font /
// extra dep: a 16px stroked SVG that inherits `currentColor`.
const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d={d} />
  </svg>
)

const ICONS: Record<StaticTabKey, ReactNode> = {
  terminal: <Icon d="M4 17l6-5-6-5M12 19h8" />,
  orchestration: (
    <Icon d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5L14.5 8m-5 8L7.5 18m9 0L14.5 16m-5-8L7.5 6M12 9a3 3 0 100 6 3 3 0 000-6z" />
  ),
  projects: <Icon d="M3 12h4l3 8 4-16 3 8h4" />,
  claude: <Icon d="M12 2l2.4 6.5L21 11l-6.6 2.5L12 20l-2.4-6.5L3 11l6.6-2.5z" />,
  library: (
    <Icon d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z" />
  ),
  extensions: (
    <Icon d="M14 7h3a2 2 0 012 2v3m-5-5V5a2 2 0 00-2-2H9a2 2 0 00-2 2v2H5a2 2 0 00-2 2v3h2.5a2 2 0 110 4H3v3a2 2 0 002 2h3v-2.5a2 2 0 114 0V21h3a2 2 0 002-2v-3" />
  ),
  tunnel: (
    <Icon d="M12 3C7 3 3 6 3 9v9a3 3 0 003 3h12a3 3 0 003-3V9c0-3-4-6-9-6zm-4 9h.01M16 12h.01M9 18h6" />
  ),
}

const EXT_ICON = (
  <Icon d="M14 7h3a2 2 0 012 2v3m-5-5V5a2 2 0 00-2-2H9a2 2 0 00-2 2v2H5a2 2 0 00-2 2v3h2.5a2 2 0 110 4H3v3a2 2 0 002 2h3v-2.5a2 2 0 114 0V21h3a2 2 0 002-2v-3" />
)

// Shared tab-button look: a soft segmented "dock". Active = primary fill with a
// lift; idle = muted, warming on hover. Icon + label so the bar reads at a
// glance — this is the surface the user lives in all day.
const tabClass = (active: boolean): string =>
  [
    "group shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5",
    "text-xs font-medium transition-all duration-150",
    active
      ? "bg-primary text-primary-content shadow-sm shadow-primary/30"
      : "text-slate-500 dark:text-slate-400 hover:bg-base-300/70 hover:text-slate-800 dark:hover:text-slate-100",
  ].join(" ")

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
        className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-base-200/60 px-1.5 py-1.5 shadow-sm backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              className={tabClass(active)}
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
              className={tabClass(active)}
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
