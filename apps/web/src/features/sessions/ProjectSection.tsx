import { Link } from "@tanstack/react-router"
import { useState } from "react"
import type { Project, SessionState } from "../../lib/types"
import { SpawnModal } from "../dispatch/SpawnModal"
import { SessionCard } from "./SessionCard"

type Props = {
  project: Project | null
  title: string
  pathHint?: string
  sessions: readonly SessionState[]
  canSpawn: boolean
}

type Agg = { icon: string; label: string; tone: string }

const aggregate = (sessions: readonly SessionState[]): Agg => {
  if (sessions.length === 0) {
    return { icon: "○", label: "empty", tone: "text-slate-500 dark:text-slate-500" }
  }
  if (sessions.some((s) => s.state === "failed")) {
    return { icon: "🔴", label: "failed", tone: "" }
  }
  if (sessions.some((s) => s.state === "needs_input")) {
    return { icon: "🟡", label: "needs input", tone: "" }
  }
  if (sessions.some((s) => s.state === "working")) {
    return { icon: "🔵", label: "working", tone: "" }
  }
  if (sessions.every((s) => s.state === "done")) {
    return { icon: "✅", label: "done", tone: "" }
  }
  return { icon: "⚪", label: "idle", tone: "" }
}

export const ProjectSection = ({ project, title, pathHint, sessions, canSpawn }: Props) => {
  const [modalOpen, setModalOpen] = useState(false)
  const agg = aggregate(sessions)

  return (
    <section
      className="flex flex-col gap-2"
      data-testid="project-section"
      data-project-id={project?.id ?? ""}
      data-project-name={project?.name ?? title}
      data-session-count={sessions.length}
    >
      <div className="flex items-stretch gap-2">
        {project ? (
          <Link
            to="/projects/$id"
            params={{ id: project.id }}
            data-testid="project-bar"
            data-project-id={project.id}
            className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 flex items-center gap-2 hover:border-sky-400 dark:hover:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition-colors"
          >
            <span className="text-base leading-none shrink-0" aria-label={agg.label}>
              {agg.icon}
            </span>
            <span className="font-medium truncate" title={pathHint ?? title}>
              {title}
            </span>
            <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            </span>
          </Link>
        ) : (
          <div
            data-testid="project-bar"
            className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 flex items-center gap-2"
          >
            <span className="text-base leading-none shrink-0" aria-label={agg.label}>
              {agg.icon}
            </span>
            <span className="font-medium truncate" title={pathHint ?? title}>
              {title}
            </span>
            <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            </span>
          </div>
        )}
        {canSpawn ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="shrink-0 w-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:border-sky-400 dark:hover:border-sky-700 transition-colors"
            title={`Spawn a new session in ${title}`}
          >
            spawn
            <br />
            new +
          </button>
        ) : null}
      </div>

      {sessions.length > 0 ? (
        <div className="pl-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sessions.map((s) => (
            <SessionCard key={s.short} session={s} />
          ))}
        </div>
      ) : null}

      {canSpawn ? (
        <SpawnModal open={modalOpen} project={project} onClose={() => setModalOpen(false)} />
      ) : null}
    </section>
  )
}
