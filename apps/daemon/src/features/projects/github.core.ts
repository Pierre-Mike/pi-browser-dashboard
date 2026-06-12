// Pure helpers for the GitHub feature. The `gh` spawning lives in github.repo;
// these stay trivially testable.

// A PR's unified patch, or an empty diff plus a warning when `gh pr diff` could
// not produce one (no auth, not a PR, detached checkout, …). The UI degrades to
// the warning rather than an error so the panel still renders.
export type GithubPrDiff = {
  readonly diff: string
  readonly warning?: string
}

type GhExec = { readonly stdout: string; readonly stderr: string; readonly exitCode: number }

// Map a raw `gh pr diff` execution to the view-model: stdout is the patch on
// success; otherwise surface stderr (or a synthetic message) as a warning.
export const prDiffOutcome = (res: GhExec): GithubPrDiff =>
  res.exitCode === 0
    ? { diff: res.stdout }
    : { diff: "", warning: res.stderr.trim() || `gh pr diff exited ${res.exitCode}` }
