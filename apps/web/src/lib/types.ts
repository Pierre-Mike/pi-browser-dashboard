// Local mirror of daemon SessionState shape. The daemon also exports this via
// `@pid/daemon/types` for the typed Hono client; this duplicate keeps web
// components typeable even when the daemon types package can't resolve in
// isolation (e.g. before `bun install`).

export type SessionStateValue = "done" | "working" | "needs_input" | "idle" | "failed" | "stopped"

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
