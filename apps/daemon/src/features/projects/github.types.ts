// Shared GitHub view-model types. Mirrors apps/web/src/lib/types.ts.

export type GithubPullRequest = {
  number: number
  title: string
  url: string
  author: string
  isDraft: boolean
  state: "OPEN" | "CLOSED" | "MERGED"
  headRefName: string
  updatedAt: string
}

export type GithubRunStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "waiting"
  | "requested"
  | "pending"

export type GithubRunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "stale"
  | null

export type GithubWorkflowRun = {
  id: number
  name: string
  status: GithubRunStatus
  conclusion: GithubRunConclusion
  headBranch: string
  headSha: string
  url: string
  event: string
  createdAt: string
}

export type GithubProjectSummary = {
  prs: GithubPullRequest[]
  runs: GithubWorkflowRun[]
  warning?: string
}
