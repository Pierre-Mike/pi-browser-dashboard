// Local mirror of daemon SessionState shape. The daemon also exports this via
// `@pid/daemon/types` for the typed Hono client; this duplicate keeps web
// components typeable even when the daemon types package can't resolve in
// isolation (e.g. before `bun install`).

// `blocked` is the current supervisor's slug for a session waiting on the user;
// older CLIs emitted `needs_input`. Both are kept so neither degrades to `idle`.
export type SessionStateValue =
  | "done"
  | "working"
  | "blocked"
  | "needs_input"
  | "idle"
  | "failed"
  | "stopped"

export type SessionState = {
  short: string
  state: SessionStateValue
  detail: string
  tempo: string
  intent: string
  name: string
  sessionId: string
  cwd: string
  createdAt: string
  updatedAt: string
  linkScanPath: string
  result?: string
}

export type Project = {
  id: string
  name: string
  path: string
  isGitRepo: boolean
  lastModified: number
  branch?: string
  githubUrl?: string
  githubOwner?: string
  githubRepo?: string
}

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

export type FileEntry = {
  name: string
  type: "dir" | "file" | "symlink" | "other"
  size: number
}

export type FileListing = {
  path: string
  entries: FileEntry[]
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
