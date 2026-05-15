// Thin wrapper around `gh` CLI. We shell out rather than hitting the GitHub
// REST API directly so the daemon inherits whatever auth the user already has
// configured for `gh` (keychain, env, etc.). Failures are returned as a
// `warning` field instead of HTTP 500 — the UI still has something to render.

import type { GithubProjectSummary, GithubPullRequest, GithubWorkflowRun } from "./github.types"

const PR_FIELDS = [
  "number",
  "title",
  "url",
  "author",
  "isDraft",
  "state",
  "headRefName",
  "updatedAt",
]
const RUN_FIELDS = [
  "databaseId",
  "name",
  "status",
  "conclusion",
  "headBranch",
  "headSha",
  "url",
  "event",
  "createdAt",
]

type Cached = { at: number; value: GithubProjectSummary }
const CACHE_MS = 30_000
const cache = new Map<string, Cached>()

const runGh = async (
  args: readonly string[],
  cwd: string,
  timeoutMs = 10_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const proc = Bun.spawn({
    cmd: ["gh", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const timer = setTimeout(() => {
    try {
      proc.kill()
    } catch {
      // already exited
    }
  }, timeoutMs)
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  clearTimeout(timer)
  return { stdout, stderr, exitCode }
}

type RawPr = {
  number: number
  title: string
  url: string
  author?: { login?: string }
  isDraft: boolean
  state: GithubPullRequest["state"]
  headRefName: string
  updatedAt: string
}

const normalizePr = (raw: RawPr): GithubPullRequest => ({
  number: raw.number,
  title: raw.title,
  url: raw.url,
  author: raw.author?.login ?? "",
  isDraft: raw.isDraft,
  state: raw.state,
  headRefName: raw.headRefName,
  updatedAt: raw.updatedAt,
})

type RawRun = {
  databaseId: number
  name: string
  status: GithubWorkflowRun["status"]
  conclusion: GithubWorkflowRun["conclusion"]
  headBranch: string
  headSha: string
  url: string
  event: string
  createdAt: string
}

const normalizeRun = (raw: RawRun): GithubWorkflowRun => ({
  id: raw.databaseId,
  name: raw.name,
  status: raw.status,
  conclusion: raw.conclusion,
  headBranch: raw.headBranch,
  headSha: raw.headSha,
  url: raw.url,
  event: raw.event,
  createdAt: raw.createdAt,
})

export const fetchGithubSummary = async (cwd: string): Promise<GithubProjectSummary> => {
  const hit = cache.get(cwd)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  const [prRes, runRes] = await Promise.all([
    runGh(["pr", "list", "--state", "open", "--limit", "20", "--json", PR_FIELDS.join(",")], cwd),
    runGh(["run", "list", "--limit", "10", "--json", RUN_FIELDS.join(",")], cwd),
  ])

  let prs: GithubPullRequest[] = []
  let runs: GithubWorkflowRun[] = []
  const warnings: string[] = []

  if (prRes.exitCode === 0) {
    try {
      const parsed = JSON.parse(prRes.stdout) as RawPr[]
      prs = parsed.map(normalizePr)
    } catch (err) {
      warnings.push(`failed to parse pr list: ${(err as Error).message}`)
    }
  } else {
    warnings.push(prRes.stderr.trim() || `gh pr list exited ${prRes.exitCode}`)
  }

  if (runRes.exitCode === 0) {
    try {
      const parsed = JSON.parse(runRes.stdout) as RawRun[]
      runs = parsed.map(normalizeRun)
    } catch (err) {
      warnings.push(`failed to parse run list: ${(err as Error).message}`)
    }
  } else {
    warnings.push(runRes.stderr.trim() || `gh run list exited ${runRes.exitCode}`)
  }

  const value: GithubProjectSummary = {
    prs,
    runs,
    ...(warnings.length > 0 ? { warning: warnings.join(" | ") } : {}),
  }
  cache.set(cwd, { at: Date.now(), value })
  return value
}

export const _resetGithubCacheForTests = (): void => {
  cache.clear()
}
