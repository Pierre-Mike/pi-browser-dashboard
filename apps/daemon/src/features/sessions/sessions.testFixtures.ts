// Shared SessionState builder for tests. sessions.routes.test.ts,
// sessions-wait.io.test.ts and sessions-explain.core.test.ts each fake a full
// SessionState and only care about a handful of overridden fields — one
// builder keeps the boilerplate defaults from drifting three ways.
import type { SessionState } from "./sessions.core"

export const makeSessionState = (overrides: Partial<SessionState> = {}): SessionState => ({
  short: "ab12",
  state: "working",
  source: "state.json",
  degradedFrom: undefined,
  detail: undefined,
  tempo: undefined,
  intent: undefined,
  name: undefined,
  sessionId: undefined,
  cwd: undefined,
  createdAt: undefined,
  updatedAt: undefined,
  linkScanPath: undefined,
  worktreePath: undefined,
  worktreeBranch: undefined,
  result: undefined,
  ...overrides,
})
