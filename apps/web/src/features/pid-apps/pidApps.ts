// Pure helpers for the pid-apps web feature — no React, no I/O — so the query
// key and serve-URL shapes are unit-testable. The hook and iframe component that
// use them are exercised via Playwright e2e (repo convention).

export type PidApp = {
  readonly id: string
  readonly label: string
  readonly icon?: string
}

// Project-scoped React Query key: apps for project A can never collide with B.
export const pidAppsQueryKey = (projectId: string) => ["pid-apps", projectId] as const

// Daemon serve URL for an app. The trailing slash makes the daemon serve the
// app's entry document (index.html unless a manifest overrides it).
export const pidAppSrc = (base: string, app: { projectId: string; appId: string }): string =>
  `${base}/projects/${app.projectId}/pid-apps/${app.appId}/`
