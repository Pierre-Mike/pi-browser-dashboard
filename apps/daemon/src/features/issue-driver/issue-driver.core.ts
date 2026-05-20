// Pure helpers for the issue-driver feature. No I/O.
//
// Drives a "GitHub issue → background Claude session → draft PR" pipeline:
// parses `gh issue list` JSON, decides which issues are eligible to spawn
// given concurrency caps, and renders the goal text + TDD system prompt
// that the background session boots with.

export type Issue = {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
  readonly repo: string
  readonly url: string
}

export type IssueKey = string

export type SchedulerState = {
  readonly running: ReadonlyMap<IssueKey, string>
  readonly processed: ReadonlySet<IssueKey>
}

export type PickEligibleInput = {
  readonly issues: readonly Issue[]
  readonly state: SchedulerState
  readonly globalCap: number
  readonly perRepoCap: number
}

export const issueKey = (i: { readonly repo: string; readonly number: number }): IssueKey =>
  `${i.repo}#${i.number}`

const NON_ALNUM = /[^a-z0-9]+/g

export const slugify = (title: string, maxLen = 40): string => {
  const lower = title.toLowerCase().trim()
  const dashed = lower.replace(NON_ALNUM, "-").replace(/^-+|-+$/g, "")
  if (dashed === "") return "issue"
  if (dashed.length <= maxLen) return dashed
  // Cut on a word boundary if there is one within the window.
  const window = dashed.slice(0, maxLen)
  const lastDash = window.lastIndexOf("-")
  const cut = lastDash > 0 ? window.slice(0, lastDash) : window
  return cut.replace(/-+$/g, "")
}

export const branchName = ({
  number,
  title,
}: {
  readonly number: number
  readonly title: string
}): string => `issue/${number}-${slugify(title)}`

type RawLabel = { readonly name?: string }
type RawIssue = {
  readonly number?: number
  readonly title?: string
  readonly body?: string
  readonly url?: string
  readonly labels?: readonly RawLabel[]
  readonly repository?: { readonly nameWithOwner?: string }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export const parseIssueListJson = (text: string, fallbackRepo?: string): readonly Issue[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: Issue[] = []
  for (const item of parsed) {
    if (!isObject(item)) continue
    const raw = item as RawIssue
    if (typeof raw.number !== "number") continue
    const repo = raw.repository?.nameWithOwner ?? fallbackRepo
    if (!repo) continue
    const labels: string[] = []
    if (Array.isArray(raw.labels)) {
      for (const l of raw.labels) {
        if (isObject(l) && typeof l.name === "string") labels.push(l.name)
      }
    }
    out.push({
      number: raw.number,
      title: typeof raw.title === "string" ? raw.title : "",
      body: typeof raw.body === "string" ? raw.body : "",
      labels,
      repo,
      url: typeof raw.url === "string" ? raw.url : "",
    })
  }
  return out
}

export const goalText = (issue: Issue): string => {
  const parts = [`/goal ${issue.title}`, "", issue.body.trim(), "", `GitHub issue: ${issue.url}`]
  return parts.join("\n")
}

export const formatTddPrompt = ({
  repo,
  issueNumber,
}: {
  readonly repo: string
  readonly issueNumber: number
}): string => `You are driving GitHub issue #${issueNumber} in ${repo} to a draft pull request using strict TDD.

Phases — do them in order, never skip:
1. Restate the issue as a concrete behavioural contract ("given X, when Y, then Z").
   If the issue is too vague to write a failing test, run:
     gh issue comment ${issueNumber} --repo ${repo} --body "Need clarification: <1-3 specific questions>"
     gh issue edit ${issueNumber} --repo ${repo} --remove-label claude-running --add-label claude-needs-info
   then stop.
2. Write ONE failing test that asserts the contract. Commit with prefix "test:".
3. Write the minimal implementation that makes the test pass. Commit with prefix "feat:" or "fix:".
4. Refactor if useful. Commit with prefix "refactor:".
5. Push the branch and open a DRAFT pull request:
     gh pr create --draft --base main --title "<short title>" --body "Closes #${issueNumber}\\n\\n<one-line summary>\\n\\nGenerated from issue #${issueNumber}."
6. Post a final comment on issue #${issueNumber} with the PR URL.

Hard rules:
- Never use --no-verify, --no-gpg-sign, or amend commits.
- Never force push.
- Never merge the PR yourself; leave it as draft for review.
- Do not add features beyond the issue's stated contract.
- If tests already exist and pass for the desired behaviour, stop and comment that no change is needed.
`

const VAGUE_MIN_BODY = 20

export const isVagueIssue = ({
  body,
}: {
  readonly title: string
  readonly body: string
}): boolean => body.trim().length < VAGUE_MIN_BODY

export const pickEligible = ({
  issues,
  state,
  globalCap,
  perRepoCap,
}: PickEligibleInput): readonly Issue[] => {
  const perRepoRunning = new Map<string, number>()
  for (const repo of state.running.values()) {
    perRepoRunning.set(repo, (perRepoRunning.get(repo) ?? 0) + 1)
  }
  const picked: Issue[] = []
  let totalRunning = state.running.size
  for (const issue of issues) {
    if (totalRunning >= globalCap) break
    const key = issueKey(issue)
    if (state.running.has(key)) continue
    if (state.processed.has(key)) continue
    const repoCount = perRepoRunning.get(issue.repo) ?? 0
    if (repoCount >= perRepoCap) continue
    picked.push(issue)
    perRepoRunning.set(issue.repo, repoCount + 1)
    totalRunning += 1
  }
  return picked
}
