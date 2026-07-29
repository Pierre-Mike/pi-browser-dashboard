// Runtime decoders for the project-GitHub endpoints in useProjectGithub.ts —
// no `@pid/shared` contract exists for these shapes, so they are validated
// locally instead of trusted with an `as`.
import { isBoolean, isNumber, isRecord, isString, parseArray } from "../../lib/guards"
import type {
  GithubProjectSummary,
  GithubPullRequest,
  GithubRunConclusion,
  GithubRunStatus,
  GithubWorkflowRun,
} from "../../lib/types"

// `git pull --ff-only` result mirrored from the daemon (git.core.ts).
export type GitPullResult = {
  readonly alreadyUpToDate: boolean
  readonly output: string
}

// The inline PR-diff viewer's payload: a single PR's unified patch, or an
// empty diff plus a warning when `gh pr diff` could not produce one. Mirrors
// the daemon's GithubPrDiff (github.core.ts).
export type GithubPrDiff = {
  readonly diff: string
  readonly warning?: string
}

const PR_STATES: readonly GithubPullRequest["state"][] = ["OPEN", "CLOSED", "MERGED"]
const isPrState = (v: unknown): v is GithubPullRequest["state"] =>
  isString(v) && (PR_STATES as readonly string[]).includes(v)

const RUN_STATUSES: readonly GithubRunStatus[] = [
  "queued",
  "in_progress",
  "completed",
  "waiting",
  "requested",
  "pending",
]
const isRunStatus = (v: unknown): v is GithubRunStatus =>
  isString(v) && (RUN_STATUSES as readonly string[]).includes(v)

const RUN_CONCLUSIONS: readonly GithubRunConclusion[] = [
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "stale",
]
const isRunConclusion = (v: unknown): v is GithubRunConclusion =>
  v === null || (isString(v) && (RUN_CONCLUSIONS as readonly string[]).includes(v))

// Both parsers below are flat: no nesting, one guard per wire field, and the
// narrowed values flow straight into the returned object. Their cyclomatic score
// is high only because it counts one branch per field (cognitive complexity, the
// metric that tracks nesting, stays at 6-7) — and every field is required by
// `GithubPullRequest` / `GithubWorkflowRun`, so there is no seam to split on the
// way `claudeConfig.parse.ts` splits required from optional. Suppressed
// deliberately rather than fragmented into single-field helpers that would read
// worse and check exactly the same things.

// fallow-ignore-next-line complexity
const parsePullRequest = (v: unknown): GithubPullRequest | null => {
  if (!isRecord(v)) return null
  const { number, title, url, author, isDraft, state, headRefName, updatedAt } = v
  if (!isNumber(number) || !isString(title) || !isString(url) || !isString(author)) return null
  if (!isBoolean(isDraft) || !isPrState(state)) return null
  if (!isString(headRefName) || !isString(updatedAt)) return null
  return { number, title, url, author, isDraft, state, headRefName, updatedAt }
}

// fallow-ignore-next-line complexity
const parseWorkflowRun = (v: unknown): GithubWorkflowRun | null => {
  if (!isRecord(v)) return null
  const { id, name, status, conclusion, headBranch, headSha, url, event, createdAt } = v
  if (!isNumber(id) || !isString(name) || !isRunStatus(status) || !isRunConclusion(conclusion))
    return null
  if (!isString(headBranch) || !isString(headSha) || !isString(url) || !isString(event)) return null
  if (!isString(createdAt)) return null
  return { id, name, status, conclusion, headBranch, headSha, url, event, createdAt }
}

export const parseGithubProjectSummary = (v: unknown): GithubProjectSummary | null => {
  if (!isRecord(v)) return null
  const { prs, runs, warning } = v
  if (warning !== undefined && !isString(warning)) return null
  const parsedPrs = parseArray(prs, parsePullRequest)
  const parsedRuns = parseArray(runs, parseWorkflowRun)
  if (!parsedPrs || !parsedRuns) return null
  return warning === undefined
    ? { prs: parsedPrs, runs: parsedRuns }
    : { prs: parsedPrs, runs: parsedRuns, warning }
}

export const parseGitPullResult = (v: unknown): GitPullResult | null => {
  if (!isRecord(v)) return null
  const { alreadyUpToDate, output } = v
  return isBoolean(alreadyUpToDate) && isString(output) ? { alreadyUpToDate, output } : null
}

export const parseGithubPrDiff = (v: unknown): GithubPrDiff | null => {
  if (!isRecord(v)) return null
  const { diff, warning } = v
  if (!isString(diff)) return null
  if (warning !== undefined && !isString(warning)) return null
  return warning === undefined ? { diff } : { diff, warning }
}
