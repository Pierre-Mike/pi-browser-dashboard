import { PatchDiff } from "@pierre/diffs/react"
import { type ReactNode, useMemo, useState } from "react"
import type {
  GithubPullRequest,
  GithubRunConclusion,
  GithubRunStatus,
  GithubWorkflowRun,
} from "../../lib/types"
import { PATCH_DIFF_OPTIONS } from "../diffs/diffsOptions"
import { parseUnifiedDiff } from "../sessions/diffParse"
import { useProjectGithub, useProjectGitPull, useProjectPrDiff } from "./useProjectGithub"

type Props = { projectId: string; githubUrl: string }

const runTone = (status: GithubRunStatus, conclusion: GithubRunConclusion): string => {
  if (status !== "completed") {
    return "badge-info"
  }
  switch (conclusion) {
    case "success":
      return "badge-success"
    case "failure":
    case "timed_out":
      return "badge-error"
    case "cancelled":
    case "skipped":
      return "badge-ghost"
    default:
      return "badge-warning"
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
    className="flex items-center gap-2 text-xs hover:bg-base-200 rounded px-2 py-1 -mx-2 min-w-0"
  >
    <span className={`badge badge-sm shrink-0 ${runTone(run.status, run.conclusion)}`}>
      {runLabel(run.status, run.conclusion)}
    </span>
    <span className="truncate flex-1 text-base-content">{run.name}</span>
    <span className="font-mono text-[10px] text-base-content/60 shrink-0">{run.headBranch}</span>
  </a>
)

// A PR row whose title toggles an inline diff; the ↗ still opens GitHub.
const PrRow = ({
  pr,
  expanded,
  onToggle,
}: {
  pr: GithubPullRequest
  expanded: boolean
  onToggle: () => void
}) => (
  <div
    data-testid="gh-pr"
    className="flex items-center gap-2 text-xs rounded px-2 py-1 -mx-2 min-w-0 hover:bg-base-200"
  >
    <button
      type="button"
      onClick={onToggle}
      data-testid="gh-pr-toggle"
      aria-expanded={expanded}
      className="flex items-center gap-2 min-w-0 flex-1 text-left"
    >
      <span className="shrink-0 w-3 text-base-content/40">{expanded ? "▾" : "▸"}</span>
      <span className="shrink-0 font-mono text-[10px] text-base-content/60">#{pr.number}</span>
      {pr.isDraft ? <span className="badge badge-sm badge-ghost shrink-0">draft</span> : null}
      <span className="truncate flex-1 text-base-content">{pr.title}</span>
      <span className="font-mono text-[10px] text-base-content/60 shrink-0">{pr.author}</span>
    </button>
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      data-testid="gh-pr-link"
      title="Open on GitHub"
      className="shrink-0 text-primary hover:underline"
    >
      ↗
    </a>
  </div>
)

const NOTE_CLASS: Record<"muted" | "warn" | "error", string> = {
  muted: "text-[11px] text-base-content/50 px-5 py-2",
  warn: "text-[11px] text-warning px-5 py-2",
  error: "text-[11px] text-error px-5 py-2",
}

const PrDiffNote = ({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warn" | "error"
  children: ReactNode
}) => <div className={NOTE_CLASS[tone]}>{children}</div>

const diffErrorText = (e: unknown): string =>
  e instanceof Error ? e.message : "failed to load diff"

// PatchDiff renders one file each, so split the PR's unified diff per file and
// render one PatchDiff apiece — same Shiki options as the session FilesTab.
const PrDiffContent = ({ diff }: { diff: string }) => {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff])
  return files.length > 0 ? (
    <div
      data-testid="gh-pr-diff"
      className="flex flex-col gap-2 px-2 pb-2 text-[12px] leading-snug"
    >
      {files.map((f) => (
        <PatchDiff key={f.path} patch={f.raw} options={PATCH_DIFF_OPTIONS} />
      ))}
    </div>
  ) : (
    <PrDiffNote>No diff content.</PrDiffNote>
  )
}

// Fetches the PR diff lazily (mounted only while expanded) and renders the
// loading / warning / content states.
const PrDiffView = ({ projectId, prNumber }: { projectId: string; prNumber: number }) => {
  const q = useProjectPrDiff(projectId, { prNumber, enabled: true })
  if (q.isError) return <PrDiffNote tone="error">{diffErrorText(q.error)}</PrDiffNote>
  const data = q.data
  if (!data) return <PrDiffNote>Loading diff…</PrDiffNote>
  if (data.warning) return <PrDiffNote tone="warn">{data.warning}</PrDiffNote>
  return <PrDiffContent diff={data.diff} />
}

// The PR list owns the single-open-row expansion state.
const PrList = ({ projectId, prs }: { projectId: string; prs: readonly GithubPullRequest[] }) => {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="flex flex-col">
      {prs.map((pr) => (
        <div key={pr.number} className="flex flex-col">
          <PrRow
            pr={pr}
            expanded={open === pr.number}
            onToggle={() => setOpen(open === pr.number ? null : pr.number)}
          />
          {open === pr.number ? <PrDiffView projectId={projectId} prNumber={pr.number} /> : null}
        </div>
      ))}
    </div>
  )
}

// Pull-result feedback: success shows whether HEAD moved, error shows why
// (a non-fast-forward pull fails rather than opening a merge editor).
const pullNote = (
  m: ReturnType<typeof useProjectGitPull>,
): { tone: string; text: string } | null => {
  if (m.isError)
    return { tone: "text-error", text: m.error instanceof Error ? m.error.message : "pull failed" }
  if (m.data) {
    return {
      tone: "text-base-content/50",
      text: m.data.alreadyUpToDate ? "Already up to date." : "Pulled latest changes.",
    }
  }
  return null
}

export const GithubPanel = ({ projectId, githubUrl }: Props) => {
  const q = useProjectGithub(projectId, true)
  const pull = useProjectGitPull(projectId)
  const note = pullNote(pull)

  return (
    <section
      data-testid="github-panel"
      className="flex flex-col gap-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-base-100 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-base-content">GitHub</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="gh-pull"
            onClick={() => pull.mutate()}
            disabled={pull.isPending}
            title="git pull --ff-only"
            className="btn btn-xs btn-ghost gap-1"
          >
            {pull.isPending ? <span className="loading loading-spinner loading-xs" /> : "⇩"}
            Pull
          </button>
          <a
            href={`${githubUrl}/pulls`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-primary hover:underline"
          >
            View all on GitHub ↗
          </a>
        </div>
      </header>

      {note ? (
        <div data-testid="gh-pull-note" className={`text-[11px] px-1 ${note.tone}`}>
          {note.text}
        </div>
      ) : null}

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-base-content/50">
          <span className="loading loading-spinner loading-sm" />
          Loading PRs and CI…
        </div>
      ) : q.isError ? (
        <div className="text-xs text-error">
          Failed to load GitHub data: {q.error instanceof Error ? q.error.message : "unknown error"}
        </div>
      ) : (
        <>
          {q.data?.warning ? (
            <div
              data-testid="gh-warning"
              className="text-[11px] rounded bg-warning/10 border border-warning/30 text-warning px-2 py-1"
            >
              {q.data.warning}
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wide text-base-content/50">
              Open PRs ({q.data?.prs.length ?? 0})
            </div>
            {q.data && q.data.prs.length > 0 ? (
              <PrList projectId={projectId} prs={q.data.prs} />
            ) : (
              <div className="text-xs text-base-content/50 italic">No open pull requests.</div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wide text-base-content/50">
              Recent CI runs ({q.data?.runs.length ?? 0})
            </div>
            {q.data && q.data.runs.length > 0 ? (
              <div className="flex flex-col">
                {q.data.runs.slice(0, 5).map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </div>
            ) : (
              <div className="text-xs text-base-content/50 italic">No workflow runs yet.</div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
