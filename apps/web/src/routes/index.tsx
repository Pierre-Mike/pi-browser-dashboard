import { createFileRoute } from "@tanstack/react-router"
import { useProjects } from "../features/projects/useProjects"
import { ProjectGrid } from "../features/sessions/ProjectGrid"
import { useSessions } from "../features/sessions/useSessions"

export const Route = createFileRoute("/")({
  component: IndexPage,
})

function IndexPage() {
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
