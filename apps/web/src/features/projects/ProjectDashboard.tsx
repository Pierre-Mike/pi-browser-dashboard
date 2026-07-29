import { getRouteApi, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { usePersistedFlag } from "../../lib/collapse"
import {
  EXT_ICON,
  PIDAPP_ICON,
  subTabButtonClass,
  TAB_ICONS,
  tabButtonClass,
  tabDockNavClass,
} from "../../lib/tabDock"
import type { Project, SessionState, SessionStateValue } from "../../lib/types"
import { ClaudeConfigPanel } from "../claude-config/ClaudeConfigPanel"
import { SpawnModal } from "../dispatch/SpawnModal"
import { ExtensionHost } from "../extensions/ExtensionHost"
import { useExtensions } from "../extensions/useExtensions"
import { FleetPanel } from "../fleet/FleetPanel"
import { LibraryPanel } from "../library/LibraryPanel"
import { NewPidAppButton } from "../pid-apps/NewPidAppButton"
import { PidAppHost } from "../pid-apps/PidAppHost"
import { usePidApps } from "../pid-apps/usePidApps"
import { PidSettingsPanel } from "../pid-settings/PidSettingsPanel"
import { RecentSessionsFeed } from "../sessions/RecentSessionsFeed"
import { SidebarReopenButton } from "../sessions/sidebarRail"
import { useSessions } from "../sessions/useSessions"
import { useTerminalStates } from "../terminal/useTerminalState"
import { CollapsibleRail, RailExpandButton } from "./CollapsibleRail"
import { FileTree } from "./FileTree"
import { GithubPanel } from "./GithubPanel"
import { ProjectTerminal } from "./ProjectTerminal"
import { collapsedRail } from "./railExpand"
import { useProjectGitPull } from "./useProjectGithub"

const route = getRouteApi("/projects/$id")

type Props = { project: Project }

type Counts = Record<SessionStateValue, number>

type StaticTabKey =
  | "sessions"
  | "github"
  | "terminal"
  | "files"
  | "claude"
  | "library"
  | "settings"
  // Declarative multi-agent runs (<project>/.pid/fleet.json — see AGENTS.md
  // "Fleet recipes"): preview a run, start one, watch the waves.
  | "fleets"
  // The single parent "Specs" dock tab; individual apps live in its left rail.
  | "pidapps"
// Extension-contributed project panels are namespaced (`ext:<name>`). Every
// per-project pid-app (dropped into <project>/.pid/ or a top-level specs/*.html)
// is selected within the Specs tab via a `pidapp:<id>` search param — a
// selected app implies the parent `pidapps` tab is active. Drawing boards moved
// to the session drill-in, where they sit in the worktree the agent edits.
type TabKey = StaticTabKey | `ext:${string}` | `pidapp:${string}`

type Tab = { readonly key: TabKey; readonly label: string }

// Namespaced tab prefixes → their shared glyph. The bare `pidapp` prefix covers
// both the parent `pidapps` tab and any selected `pidapp:<id>`.
const NAMESPACE_ICONS = [
  ["ext:", EXT_ICON],
  ["pidapp", PIDAPP_ICON],
] as const

// Each project tab borrows the shared section glyph (see lib/tabDock) so a
// "Terminal" / "Claude" / "Library" tab looks identical to the root dashboard.
const projectTabIcon = (key: TabKey) => {
  const ns = NAMESPACE_ICONS.find(([prefix]) => key.startsWith(prefix))
  if (ns) return ns[1]
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
  // Not surfaced as its own pill (yet) — the summary bar only calls out
  // states that need attention; kept here so `Counts` stays total over
  // SessionStateValue and `tally` never drops a session on the floor.
  unknown: 0,
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

// Title reflects the last pull result (a non-fast-forward pull fails rather
// than opening a merge editor).
const pullTitle = (pull: ReturnType<typeof useProjectGitPull>): string => {
  if (pull.isError) return "pull failed"
  if (!pull.data) return "git pull --ff-only"
  return pull.data.alreadyUpToDate ? "Already up to date." : "Pulled latest changes."
}

const PULL_BTN_BASE =
  "text-[10px] uppercase tracking-wide rounded-btn px-1.5 py-0.5 hover:opacity-80"
const PULL_BTN_TONE = "bg-neutral text-neutral-content"

// ff-only Pull, sitting beside the top GitHub link.
const GitPullButton = ({ pull }: { pull: ReturnType<typeof useProjectGitPull> }) => (
  <button
    type="button"
    data-testid="gh-pull"
    onClick={() => pull.mutate()}
    disabled={pull.isPending}
    title={pullTitle(pull)}
    className={`${PULL_BTN_BASE} ${pull.isError ? "bg-error text-error-content" : PULL_BTN_TONE}`}
  >
    {pull.isPending ? <span className="loading loading-spinner loading-xs" /> : "Pull ⇩"}
  </button>
)

// GitHub link + Pull button, rendered as a pair whenever the project has a
// remote — split out of ProjectIdentity to keep that function's branching low.
const GithubActions = ({
  project,
  pull,
}: {
  project: Project
  pull: ReturnType<typeof useProjectGitPull>
}) =>
  project.githubUrl ? (
    <>
      <a
        data-testid="github-link"
        href={project.githubUrl}
        target="_blank"
        rel="noreferrer"
        title={`${project.githubOwner}/${project.githubRepo} on GitHub`}
        className="text-[10px] uppercase tracking-wide rounded-btn bg-neutral text-neutral-content px-1.5 py-0.5 hover:opacity-80 shrink-0"
      >
        GitHub ↗
      </a>
      <GitPullButton pull={pull} />
    </>
  ) : null

// The project identity cluster: name, isolation warning, branch, GitHub link
// and Pull button. The absolute path is no longer shown inline (it's already
// one hover away in the sidebar) — it lives only as this element's `title`,
// discoverable the same way the branch/GitHub titles already are.
const ProjectIdentity = ({
  project,
  pull,
}: {
  project: Project
  pull: ReturnType<typeof useProjectGitPull>
}) => (
  <h1
    className="text-sm font-semibold flex items-center gap-1.5 min-w-0 shrink"
    title={project.path}
  >
    <span className="truncate">{project.name}</span>
    {project.isGitRepo ? null : (
      <span
        className="text-[10px] uppercase tracking-wide rounded-badge bg-warning/15 text-warning px-1.5 py-0.5 shrink-0"
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
        className="inline-flex items-center gap-1 rounded-badge bg-base-200 text-base-content/80 font-mono text-[10px] px-1.5 py-0.5 max-w-[140px] truncate shrink-0"
      >
        <span aria-hidden>⎇</span>
        {project.branch}
      </span>
    ) : null}
    <GithubActions project={project} pull={pull} />
  </h1>
)

export const ProjectDashboard = ({ project }: Props) => {
  const sessionsQ = useSessions()
  // Screen classification for this project's sessions, including ones nobody has
  // opened (the daemon's unattended poller). Cards show it only on disagreement.
  const terminalStates = useTerminalStates()
  const extensionsQ = useExtensions()
  const pidAppsQ = usePidApps(project.id)
  const pull = useProjectGitPull(project.id)
  const [spawnOpen, setSpawnOpen] = useState(false)
  // Per-tab left-rail collapse — reclaims the rail's width for the spec host /
  // canvas. Persisted per browser (see usePersistedFlag).
  const specsRail = usePersistedFlag("pid:specs:rail-collapsed")
  const sessions = (sessionsQ.data ?? []).filter((s) => s.cwd === project.path)
  const counts = tally(sessions)

  // Only enabled iframe-tier extensions that contribute a project panel.
  // A local extension belongs to one project (its `.pid/extensions` repo), so
  // its panel shows only on that project; global extensions show everywhere.
  const extPanels = (extensionsQ.data ?? []).filter(
    (e) =>
      e.enabled !== false &&
      e.tier === "iframe" &&
      (e.contributes?.projectPanels?.length ?? 0) > 0 &&
      (e.scope !== "local" || e.projectPath === project.path),
  )

  const pidApps = pidAppsQ.data ?? []

  const tabs: readonly Tab[] = useMemo(() => {
    // Activity leads the dock because it is also the default tab (see the
    // `tab = "sessions"` fallback below): opening a project puts you on the
    // leftmost tab, so first and default never disagree.
    const base: Tab[] = [
      { key: "sessions", label: `Activity${sessions.length ? ` · ${sessions.length}` : ""}` },
      { key: "terminal", label: "Terminal" },
    ]
    if (project.githubUrl) base.push({ key: "github", label: "GitHub" })
    base.push(
      { key: "files", label: "Files" },
      { key: "claude", label: "Claude" },
      { key: "library", label: "Library" },
      { key: "settings", label: "Settings" },
      { key: "fleets", label: "Fleets" },
      // One parent tab for every pid-app; the individual apps hang off its left
      // rail rather than each claiming a top-level dock tab.
      { key: "pidapps", label: "Specs" },
      ...extPanels.map((e): Tab => ({ key: `ext:${e.name}`, label: e.name })),
    )
    return base
  }, [project.githubUrl, sessions.length, extPanels])

  const { tab = "sessions" } = route.useSearch()
  const navigate = route.useNavigate()
  const setTab = (next: TabKey) => navigate({ search: (prev) => ({ ...prev, tab: next }) })

  // The Specs tab is active for its own key or any selected app; a bare
  // `pidapps` (or an id no longer present) falls back to the first app.
  const pidAppsActive = tab === "pidapps" || tab.startsWith("pidapp:")
  const selectedFromTab = tab.startsWith("pidapp:") ? tab.slice("pidapp:".length) : undefined
  const selectedAppId = pidApps.find((a) => a.id === selectedFromTab)?.id ?? pidApps[0]?.id

  // A collapsed rail leaves nothing behind beside the panel, so the topbar hosts
  // the chip that brings it back.
  const railChip = collapsedRail({
    specsActive: pidAppsActive,
    specsCollapsed: specsRail.value,
  })

  const fillViewport =
    tab === "terminal" ||
    tab === "files" ||
    tab === "claude" ||
    tab === "library" ||
    tab.startsWith("ext:") ||
    tab === "pidapps" ||
    tab.startsWith("pidapp:")

  return (
    <div
      data-testid="project-dashboard"
      className={`flex flex-col gap-1 ${fillViewport ? "h-screen -my-4 pt-1" : ""}`}
    >
      <div data-testid="project-topbar" className="flex items-center gap-2">
        <SidebarReopenButton />

        <Link
          to="/"
          className="text-[11px] text-base-content/60 hover:underline shrink-0"
          title="All projects"
        >
          ←
        </Link>

        <ProjectIdentity project={project} pull={pull} />

        <nav
          data-testid="project-tabs"
          role="tablist"
          aria-label="Project sections"
          className={`${tabDockNavClass} flex-1 min-w-0`}
        >
          {tabs.map((t) => {
            // A parent tab stays lit while any of its children is selected.
            const active = t.key === "pidapps" ? pidAppsActive : tab === t.key
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

        {railChip ? <RailExpandButton rail={railChip} onToggle={specsRail.toggle} /> : null}

        <div className="flex items-center gap-1 shrink-0">
          {counts.working > 0 ? (
            <Pill label="working" value={counts.working} tone="bg-primary/15 text-primary" />
          ) : null}
          {counts.blocked > 0 ? (
            <Pill label="blocked" value={counts.blocked} tone="bg-warning/15 text-warning" />
          ) : null}
          {counts.needs_input > 0 ? (
            <Pill
              label="needs input"
              value={counts.needs_input}
              tone="bg-warning/15 text-warning"
            />
          ) : null}
          {counts.failed > 0 ? (
            <Pill label="failed" value={counts.failed} tone="bg-error/15 text-error" />
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
      </div>

      <div
        role="tabpanel"
        data-testid="project-tab-panel-sessions"
        className={tab === "sessions" ? "flex flex-col gap-3" : "hidden"}
      >
        {sessions.length === 0 ? (
          <div className="card border border-dashed border-base-300 bg-base-200/40">
            <div className="card-body items-center gap-1 py-8 text-center text-sm text-base-content/60">
              No sessions yet — use{" "}
              <span className="font-medium text-base-content/80">Spawn +</span> to start one.
            </div>
          </div>
        ) : (
          <RecentSessionsFeed
            projects={[project]}
            sessions={sessions}
            showProjectName={false}
            limit={Number.POSITIVE_INFINITY}
            terminalStates={terminalStates}
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
        <FileTree resource={{ kind: "projects", id: project.id }} />
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

      <div
        role="tabpanel"
        data-testid="project-tab-panel-fleets"
        className={tab === "fleets" ? "flex flex-col gap-3" : "hidden"}
      >
        <FleetPanel projectId={project.id} projectName={project.name} />
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

      {/* One "Specs" section: a left rail of sub-tabs (one per pid-app) beside
          the sandboxed host of whichever app is selected. */}
      <div
        role="tabpanel"
        data-testid="project-tab-panel-pidapps"
        className={pidAppsActive ? "flex flex-1 min-h-0 gap-2" : "hidden"}
      >
        <CollapsibleRail
          collapsed={specsRail.value}
          onToggle={specsRail.toggle}
          ariaLabel="Specs and apps"
          testid="pidapp-subtabs"
        >
          {pidApps.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={selectedAppId === a.id}
              data-testid={`pidapp-subtab-${a.id}`}
              data-active={selectedAppId === a.id}
              onClick={() => setTab(`pidapp:${a.id}`)}
              title={a.label}
              className={subTabButtonClass(selectedAppId === a.id)}
            >
              <span className="shrink-0">{a.icon ?? PIDAPP_ICON}</span>
              <span className="truncate">{a.label}</span>
            </button>
          ))}
          <NewPidAppButton projectId={project.id} onCreated={(id) => setTab(`pidapp:${id}`)} />
        </CollapsibleRail>

        <div className="flex flex-1 min-h-0 flex-col">
          {pidApps.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-box border border-dashed border-base-300 bg-base-200/40 p-8 text-center text-sm text-base-content/60">
              No specs yet — drop an HTML file into{" "}
              <span className="font-mono text-base-content/80">specs/</span> or click{" "}
              <span className="font-medium text-base-content/80">+</span> to create one.
            </div>
          ) : (
            pidApps.map((a) => {
              const key: TabKey = `pidapp:${a.id}`
              return (
                <div
                  key={key}
                  role="tabpanel"
                  data-testid={`project-tab-panel-pidapp-${a.id}`}
                  className={selectedAppId === a.id ? "flex flex-col flex-1 min-h-0" : "hidden"}
                >
                  <PidAppHost projectId={project.id} appId={a.id} />
                </div>
              )
            })
          )}
        </div>
      </div>

      <SpawnModal open={spawnOpen} project={project} onClose={() => setSpawnOpen(false)} />
    </div>
  )
}
