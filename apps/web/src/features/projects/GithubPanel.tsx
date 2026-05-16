import type {
  GithubPullRequest,
  GithubRunConclusion,
  GithubRunStatus,
  GithubWorkflowRun,
} from "../../lib/types"
import { useProjectGithub } from "./useProjectGithub"

type Props = { projectId: string; githubUrl: string }

const runTone = (status: GithubRunStatus, conclusion: GithubRunConclusion): string => {
  if (status !== "completed") {
    return "bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200"
  }
  switch (conclusion) {
    case "success":
      return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200"
    case "failure":
    case "timed_out":
      return "bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200"
    case "cancelled":
    case "skipped":
      return "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
    default:
      return "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
  }
}

const runLabel = (status: GithubRunStatus, conclusion: GithubRunConclusion): string => {
  if (status !== "completed") return status.replace(/_/g, " ")
  return conclusion ?? "unknown"
}

const RunRow = ({ run }: { run: GithubWorkflowRun }) => (
  <a
    href={run.url}
    target="_blank"
    rel="noreferrer"
    data-testid="gh-run"
    className="flex items-center gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-900/60 rounded px-2 py-1 -mx-2 min-w-0"
  >
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${runTone(run.status, run.conclusion)}`}
    >
      {runLabel(run.status, run.conclusion)}
    </span>
    <span className="truncate flex-1 text-slate-700 dark:text-slate-200">{run.name}</span>
    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
      {run.headBranch}
    </span>
  </a>
)

const PrRow = ({ pr }: { pr: GithubPullRequest }) => (
  <a
    href={pr.url}
    target="_blank"
    rel="noreferrer"
    data-testid="gh-pr"
    className="flex items-center gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-900/60 rounded px-2 py-1 -mx-2 min-w-0"
  >
    <span className="shrink-0 font-mono text-[10px] text-slate-500 dark:text-slate-400">
      #{pr.number}
    </span>
    {pr.isDraft ? (
      <span className="shrink-0 rounded-full bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-300">
        draft
      </span>
    ) : null}
    <span className="truncate flex-1 text-slate-700 dark:text-slate-200">{pr.title}</span>
    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
      {pr.author}
    </span>
  </a>
)

export const GithubPanel = ({ projectId, githubUrl }: Props) => {
  const q = useProjectGithub(projectId, true)

  return (
    <section
      data-testid="github-panel"
      className="flex flex-col gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">GitHub</h2>
        <a
          href={`${githubUrl}/pulls`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-sky-700 dark:text-sky-300 hover:underline"
        >
          View all on GitHub ↗
        </a>
      </header>

      {q.isLoading ? (
        <div className="text-xs text-slate-500">Loading PRs and CI…</div>
      ) : q.isError ? (
        <div className="text-xs text-rose-600">
          Failed to load GitHub data: {q.error instanceof Error ? q.error.message : "unknown error"}
        </div>
      ) : (
        <>
          {q.data?.warning ? (
            <div
              data-testid="gh-warning"
              className="text-[11px] rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 px-2 py-1"
            >
              {q.data.warning}
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Open PRs ({q.data?.prs.length ?? 0})
            </div>
            {q.data && q.data.prs.length > 0 ? (
              <div className="flex flex-col">
                {q.data.prs.map((pr) => (
                  <PrRow key={pr.number} pr={pr} />
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400 italic">
                No open pull requests.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Recent CI runs ({q.data?.runs.length ?? 0})
            </div>
            {q.data && q.data.runs.length > 0 ? (
              <div className="flex flex-col">
                {q.data.runs.slice(0, 5).map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400 italic">
                No workflow runs yet.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
