import { createFileRoute, Link } from "@tanstack/react-router"
import { ProjectDashboard } from "../features/projects/ProjectDashboard"
import { useProjects } from "../features/projects/useProjects"
import { coerceExtTab } from "../lib/tabParams"

const PROJECT_STATIC_TAB_KEYS = [
  "sessions",
  "github",
  "terminal",
  "orchestration",
  "files",
  "claude",
  "library",
] as const
type ProjectTabKey = (typeof PROJECT_STATIC_TAB_KEYS)[number] | `ext:${string}`

export const Route = createFileRoute("/projects/$id")({
  validateSearch: (search: Record<string, unknown>): { tab?: ProjectTabKey } => {
    const tab = coerceExtTab(search.tab, PROJECT_STATIC_TAB_KEYS)
    return tab === undefined ? {} : { tab }
  },
  component: ProjectDashboardPage,
})

function ProjectDashboardPage() {
  const { id } = Route.useParams()
  const projectsQ = useProjects()

  if (projectsQ.isLoading) {
    return <div className="text-sm text-slate-500">Loading…</div>
  }

  if (projectsQ.isError) {
    return (
      <div className="text-sm text-rose-600">
        Failed to load projects:{" "}
        {projectsQ.error instanceof Error ? projectsQ.error.message : "unknown error"}
      </div>
    )
  }

  const project = (projectsQ.data ?? []).find((p) => p.id === id)
  if (!project) {
    return (
      <div className="flex flex-col gap-2">
        <Link to="/" className="text-xs text-slate-500 hover:underline">
          ← All projects
        </Link>
        <div className="text-sm text-slate-600 dark:text-slate-400">
          Project <span className="font-mono">{id}</span> not found.
        </div>
      </div>
    )
  }

  return <ProjectDashboard project={project} />
}
