import { cwdTail } from "../../lib/format"
import type { Project, SessionState } from "../../lib/types"
import { ProjectSection } from "./ProjectSection"

type Props = {
  projects: readonly Project[]
  sessions: readonly SessionState[]
}

const groupSessions = (
  projects: readonly Project[],
  sessions: readonly SessionState[],
): { byProjectId: Map<string, SessionState[]>; orphansByCwd: Map<string, SessionState[]> } => {
  const knownPaths = new Map<string, string>() // path -> project.id
  for (const p of projects) knownPaths.set(p.path, p.id)

  const byProjectId = new Map<string, SessionState[]>()
  const orphansByCwd = new Map<string, SessionState[]>()

  for (const s of sessions) {
    const projectId = knownPaths.get(s.cwd)
    if (projectId) {
      const arr = byProjectId.get(projectId) ?? []
      arr.push(s)
      byProjectId.set(projectId, arr)
    } else {
      const arr = orphansByCwd.get(s.cwd) ?? []
      arr.push(s)
      orphansByCwd.set(s.cwd, arr)
    }
  }

  return { byProjectId, orphansByCwd }
}

const sortProjects = (
  projects: readonly Project[],
  byProjectId: Map<string, SessionState[]>,
): Project[] => {
  return [...projects].sort((a, b) => {
    const ac = byProjectId.get(a.id)?.length ?? 0
    const bc = byProjectId.get(b.id)?.length ?? 0
    if (ac !== bc) return bc - ac
    return b.lastModified - a.lastModified
  })
}

export const ProjectGrid = ({ projects, sessions }: Props) => {
  const { byProjectId, orphansByCwd } = groupSessions(projects, sessions)
  const ordered = sortProjects(projects, byProjectId)

  return (
    <div className="flex flex-col gap-5">
      {ordered.map((p) => (
        <ProjectSection
          key={p.id}
          project={p}
          title={p.isGitRepo ? p.name : `⚠ ${p.name}`}
          pathHint={p.path}
          sessions={byProjectId.get(p.id) ?? []}
          canSpawn
        />
      ))}

      {orphansByCwd.size > 0 ? (
        <div className="flex flex-col gap-4 pt-4 border-t border-dashed border-slate-300 dark:border-slate-800">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Other
          </div>
          {[...orphansByCwd.entries()].map(([cwd, list]) => (
            <ProjectSection
              key={cwd}
              project={null}
              title={cwdTail(cwd)}
              pathHint={cwd}
              sessions={list}
              canSpawn={false}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
