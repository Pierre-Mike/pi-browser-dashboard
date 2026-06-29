// Pure parsers/mergers for the dashboard's GLOBAL settings file
// (<claudeConfigDir>/pid-dashboard/settings.json). No I/O — file reads/writes
// live in global-settings.repo.ts.
//
// This file is the single source of truth for values that were previously
// hard-coded across the daemon: the git defaults (base branch / remote), the
// library locations, the orchestration (spawn) defaults, and the network ports.
// Like pid-settings.core, parse/merge fill missing or invalid fields from
// DEFAULT_GLOBAL_SETTINGS field-by-field, so a hand-edited or partial file never
// throws and a bad patch can never corrupt stored state. New keys can be added
// without a migration.

export type GitSettings = {
  /** Branch PRs target and worktrees branch from. */
  readonly defaultBranch: string
  /** Remote name used for fetch/push/PR base. */
  readonly remoteName: string
}

export type LibrarySettings = {
  /** Path to the library catalog YAML. */
  readonly catalogPath: string
  /** Path to the `agentic` checkout backing `library install`. */
  readonly agenticRepoPath: string
}

export type OrchestrationSettings = {
  /** Binary used to spawn sessions (`claude --bg …`). */
  readonly claudeBin: string
  /** Agent pre-filled in the dispatch bar (empty = none). */
  readonly defaultAgent: string
  /** Permission mode pre-filled in the dispatch bar (empty = none). */
  readonly defaultPermissionMode: string
  /** Reasoning effort pre-filled in the dispatch bar (empty = none). */
  readonly defaultEffort: string
  /** Max sessions a single dispatch may fan out to. */
  readonly maxParallel: number
}

export type NetworkSettings = {
  /** Root under which projects are discovered. */
  readonly projectsRoot: string
  /** Port the daemon listens on. */
  readonly appPort: number
  /** Local port the Cloudflare quick-tunnel exposes publicly. */
  readonly tunnelPort: number
}

// A named, reusable set of skills (slash-commands) the spawn modal can apply in
// one click. Stored globally so the same preset is offered in every project.
export type SkillGroup = {
  /** Display name, also the dedupe key. */
  readonly name: string
  /** Skill ids selected when this group is applied, in selection order. */
  readonly skills: readonly string[]
}

export type GlobalSettings = {
  readonly git: GitSettings
  readonly library: LibrarySettings
  readonly orchestration: OrchestrationSettings
  readonly network: NetworkSettings
  readonly skillGroups: readonly SkillGroup[]
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  git: { defaultBranch: "main", remoteName: "origin" },
  library: {
    catalogPath: "~/.claude/skills/library/library.yaml",
    agenticRepoPath: "~/Github/agentic",
  },
  orchestration: {
    claudeBin: "claude",
    defaultAgent: "",
    defaultPermissionMode: "",
    defaultEffort: "",
    maxParallel: 10,
  },
  network: {
    projectsRoot: "~/Github",
    appPort: 8787,
    tunnelPort: 5173,
  },
  skillGroups: [],
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// A non-empty string, else null (so a default can fill in).
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

// A string that may be intentionally empty (agent/mode/effort "none").
const optStr = (v: unknown): string | null => (typeof v === "string" ? v : null)

// A positive integer, else null.
const posInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null

const readGit = (raw: unknown, base: GitSettings): GitSettings => {
  if (!isObject(raw)) return base
  return {
    defaultBranch: str(raw.defaultBranch) ?? base.defaultBranch,
    remoteName: str(raw.remoteName) ?? base.remoteName,
  }
}

const readLibrary = (raw: unknown, base: LibrarySettings): LibrarySettings => {
  if (!isObject(raw)) return base
  return {
    catalogPath: str(raw.catalogPath) ?? base.catalogPath,
    agenticRepoPath: str(raw.agenticRepoPath) ?? base.agenticRepoPath,
  }
}

const readOrchestration = (raw: unknown, base: OrchestrationSettings): OrchestrationSettings => {
  if (!isObject(raw)) return base
  return {
    claudeBin: str(raw.claudeBin) ?? base.claudeBin,
    defaultAgent: optStr(raw.defaultAgent) ?? base.defaultAgent,
    defaultPermissionMode: optStr(raw.defaultPermissionMode) ?? base.defaultPermissionMode,
    defaultEffort: optStr(raw.defaultEffort) ?? base.defaultEffort,
    maxParallel: posInt(raw.maxParallel) ?? base.maxParallel,
  }
}

const readNetwork = (raw: unknown, base: NetworkSettings): NetworkSettings => {
  if (!isObject(raw)) return base
  return {
    projectsRoot: str(raw.projectsRoot) ?? base.projectsRoot,
    appPort: posInt(raw.appPort) ?? base.appPort,
    tunnelPort: posInt(raw.tunnelPort) ?? base.tunnelPort,
  }
}

// Validate a group's skill id list: non-empty strings only, trimmed, deduped,
// order preserved. Anything else (missing, wrong-typed, blank) is dropped.
const readSkillIds = (raw: unknown): readonly string[] => {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw) {
    const id = str(v)?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Validate the skill-groups list: each entry needs a non-empty name (the dedupe
// key, first occurrence wins) and a skills list (coerced to [] when absent).
// A non-array input leaves the base list untouched (so a patch can omit it).
const readSkillGroups = (raw: unknown, base: readonly SkillGroup[]): readonly SkillGroup[] => {
  if (!Array.isArray(raw)) return base
  const seenNames = new Set<string>()
  const out: SkillGroup[] = []
  for (const entry of raw) {
    if (!isObject(entry)) continue
    const name = str(entry.name)
    if (name === null || seenNames.has(name)) continue
    seenNames.add(name)
    out.push({ name, skills: readSkillIds(entry.skills) })
  }
  return out
}

const fromObject = (parsed: Record<string, unknown>, base: GlobalSettings): GlobalSettings => ({
  git: readGit(parsed.git, base.git),
  library: readLibrary(parsed.library, base.library),
  orchestration: readOrchestration(parsed.orchestration, base.orchestration),
  network: readNetwork(parsed.network, base.network),
  skillGroups: readSkillGroups(parsed.skillGroups, base.skillGroups),
})

// Parse a settings.json text into fully-populated GlobalSettings. Empty,
// missing, malformed, or wrong-typed input falls back to defaults field-by-field.
export const parseGlobalSettings = (text: string | null | undefined): GlobalSettings => {
  if (text == null || text.trim() === "") return DEFAULT_GLOBAL_SETTINGS
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return DEFAULT_GLOBAL_SETTINGS
  }
  if (!isObject(parsed)) return DEFAULT_GLOBAL_SETTINGS
  return fromObject(parsed, DEFAULT_GLOBAL_SETTINGS)
}

export type GlobalSettingsPatch = {
  readonly git?: Partial<GitSettings>
  readonly library?: Partial<LibrarySettings>
  readonly orchestration?: Partial<OrchestrationSettings>
  readonly network?: Partial<NetworkSettings>
  // A list, not a partial: providing it replaces the whole set; omitting it
  // leaves the stored groups untouched.
  readonly skillGroups?: readonly SkillGroup[]
}

// Apply a partial patch over current settings. Invalid field values are ignored
// (current value wins), reusing the same per-field validation as parse so a bad
// request can't corrupt stored state.
export const mergeGlobalSettings = (
  current: GlobalSettings,
  patch: GlobalSettingsPatch | null | undefined,
): GlobalSettings => {
  if (!isObject(patch)) return current
  return fromObject(patch as Record<string, unknown>, current)
}

export const serializeGlobalSettings = (s: GlobalSettings): string =>
  `${JSON.stringify(s, null, 2)}\n`

// Ordered diff/worktree base-ref candidates derived from the configured git
// settings. The configured `<remote>/<branch>` is preferred (worktrees are cut
// from it — see AGENTS.md), then the bare branch, then master fallbacks for
// unusual repos, then HEAD as a last resort. Duplicates are dropped so the
// default (origin/main) yields the historical candidate list unchanged.
export const gitBaseCandidates = (git: GitSettings): readonly string[] => {
  const ordered = [
    `${git.remoteName}/${git.defaultBranch}`,
    `${git.remoteName}/master`,
    git.defaultBranch,
    "master",
    "HEAD",
  ]
  return [...new Set(ordered)]
}
