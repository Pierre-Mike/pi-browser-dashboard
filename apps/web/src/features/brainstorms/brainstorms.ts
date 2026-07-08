// Pure helpers for the brainstorms web feature — no React, no I/O — so the
// query key and companion-session conventions are unit-testable (repo
// convention, mirrors pid-apps/pidApps.ts).

export type Brainstorm = {
  readonly id: string
  readonly label: string
  // Absolute path of the canvas document on the daemon's disk — embedded in
  // companion prompts so an agent can Read/Write the drawing directly.
  readonly file: string
  readonly updatedAt: string
}

// Project-scoped React Query key: brainstorms for project A never collide with B.
export const brainstormsQueryKey = (projectId: string) => ["brainstorms", projectId] as const
