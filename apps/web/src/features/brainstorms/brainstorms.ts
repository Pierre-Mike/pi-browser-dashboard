// Pure helpers for the brainstorms web feature — no React, no I/O — so the
// query key and companion-session conventions are unit-testable (repo
// convention, mirrors pid-apps/pidApps.ts).

// V1 boards are React-Flow canvas documents; V2 boards are native Excalidraw
// files. The daemon discovers both under <project>/.pid/brainstorms/.
export type BrainstormKind = "canvas" | "excalidraw"

export type Brainstorm = {
  readonly id: string
  readonly label: string
  readonly kind: BrainstormKind
  // Absolute path of the drawing document on the daemon's disk — embedded in
  // companion prompts so an agent can Read/Write the drawing directly.
  readonly file: string
  readonly updatedAt: string
}

// Project-scoped React Query key: brainstorms for project A never collide with B.
export const brainstormsQueryKey = (projectId: string) => ["brainstorms", projectId] as const
