import { createFileRoute, Link } from "@tanstack/react-router"
import { ProjectDashboard } from "../features/projects/ProjectDashboard"
import { useProjects } from "../features/projects/useProjects"

export const Route = createFileRoute("/projects/$id")({
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
