// Web-side view types.
//
// `SessionState` and `Project` used to be declared here as hand-written
// "local mirrors" of the daemon's shapes. They had drifted: the mirror was
// missing `worktreePath`/`worktreeBranch` and `lastCommitMs`, and typed nine
// nullable daemon fields as required `string` — nothing could have caught
// either, because there was no single declaration for the two copies to
// disagree with. Both now come from `@pid/shared`, where they are effect
// `Schema`s that also decode a response at runtime.
//
// The types below are genuinely web-only (GitHub panel view models, transcript
// rendering) and stay local until a second workspace needs them.
export type { Project, SessionState, SessionStateSlug } from "@pid/shared"

import type { SessionStateSlug } from "@pid/shared"

/**
 * @deprecated Use `SessionStateSlug` from `@pid/shared`. Kept as an alias so
 * the rename lands in one commit rather than rippling through 35 files.
 */
export type SessionStateValue = SessionStateSlug

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

export type FileContent = {
  path: string
  size: number
  isBinary: boolean
  truncated: boolean
  content: string
}

export type TranscriptMessage = {
  type: "user" | "assistant" | "tool_use" | "tool_result" | "system" | "result"
  // Free-form payload — the JSONL format varies by message type. We render
  // best-effort and fall back to a <pre> dump.
  content?: unknown
  text?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
  message?: unknown
  result?: string
  timestamp?: string
}
