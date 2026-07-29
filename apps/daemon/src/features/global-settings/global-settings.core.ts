// Pure parsers/mergers for the dashboard's GLOBAL settings file
// (<claudeConfigDir>/pid-dashboard/settings.json). No I/O — file reads/writes
// live in global-settings.io.ts.
//
// The *shape* is the `GlobalSettings` contract in `@pid/shared`, because
// `apps/web` edits the same document; this file owns the *policy* — the default
// value of every field, and the per-field validation that makes a hand-edited
// file safe to read. Like pid-settings.core, parse/merge fill missing or invalid
// fields from DEFAULT_GLOBAL_SETTINGS field-by-field, so a partial file never
// throws and a bad patch can never corrupt stored state. New keys can be added
// without a migration.
import type {
  GitSettings,
  GlobalSettings,
  GlobalSettingsPatch,
  LibrarySettings,
  NetworkSettings,
  OrchestrationSettings,
  SkillGroup,
  UiSettings,
} from "@pid/shared"

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
  // Both halves empty = no machine-wide theme default, so a browser with no pick
  // of its own gets whatever apps/web calls its default. Naming `pid`/`system`
  // here would be a second copy of a decision that belongs next to
  // tailwind.config.js, and it would silently outvote a future rename there.
  ui: { themeFamily: "", themeMode: "" },
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

const readGit = (input: { readonly raw: unknown; readonly base: GitSettings }): GitSettings => {
  const { raw, base } = input
  if (!isObject(raw)) return base
  return {
    defaultBranch: str(raw.defaultBranch) ?? base.defaultBranch,
    remoteName: str(raw.remoteName) ?? base.remoteName,
  }
}

const readLibrary = (input: {
  readonly raw: unknown
  readonly base: LibrarySettings
}): LibrarySettings => {
  const { raw, base } = input
  if (!isObject(raw)) return base
  return {
    catalogPath: str(raw.catalogPath) ?? base.catalogPath,
    agenticRepoPath: str(raw.agenticRepoPath) ?? base.agenticRepoPath,
  }
}

const readOrchestration = (input: {
  readonly raw: unknown
  readonly base: OrchestrationSettings
}): OrchestrationSettings => {
  const { raw, base } = input
  if (!isObject(raw)) return base
  return {
    claudeBin: str(raw.claudeBin) ?? base.claudeBin,
    defaultAgent: optStr(raw.defaultAgent) ?? base.defaultAgent,
    defaultPermissionMode: optStr(raw.defaultPermissionMode) ?? base.defaultPermissionMode,
    defaultEffort: optStr(raw.defaultEffort) ?? base.defaultEffort,
    maxParallel: posInt(raw.maxParallel) ?? base.maxParallel,
  }
}

const readNetwork = (input: {
  readonly raw: unknown
  readonly base: NetworkSettings
}): NetworkSettings => {
  const { raw, base } = input
  if (!isObject(raw)) return base
  return {
    projectsRoot: str(raw.projectsRoot) ?? base.projectsRoot,
    appPort: posInt(raw.appPort) ?? base.appPort,
    tunnelPort: posInt(raw.tunnelPort) ?? base.tunnelPort,
  }
}

// The theme halves are opaque here on purpose: which families and modes exist is
// declared in apps/web/src/lib/ui/theme.core.ts, next to the tailwind config that
// emits them. Validating a family name in the daemon would mean a web-only
// rename needed a daemon release, and would turn an unrecognised value into a
// *rejected* one — the file must be able to say "vaporwave" and let the reader
// fall back per half. So the only rule is "a string" (`optStr`, since "" is the
// meaningful "unset", exactly as in orchestration.defaultAgent).
const readUi = (input: { readonly raw: unknown; readonly base: UiSettings }): UiSettings => {
  const { raw, base } = input
  if (!isObject(raw)) return base
  return {
    themeFamily: optStr(raw.themeFamily) ?? base.themeFamily,
    themeMode: optStr(raw.themeMode) ?? base.themeMode,
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
const readSkillGroups = (input: {
  readonly raw: unknown
  readonly base: readonly SkillGroup[]
}): readonly SkillGroup[] => {
  const { raw, base } = input
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

const fromObject = (input: {
  readonly parsed: Record<string, unknown>
  readonly base: GlobalSettings
}): GlobalSettings => {
  const { parsed, base } = input
  return {
    git: readGit({ raw: parsed.git, base: base.git }),
    library: readLibrary({ raw: parsed.library, base: base.library }),
    orchestration: readOrchestration({ raw: parsed.orchestration, base: base.orchestration }),
    network: readNetwork({ raw: parsed.network, base: base.network }),
    ui: readUi({ raw: parsed.ui, base: base.ui }),
    skillGroups: readSkillGroups({ raw: parsed.skillGroups, base: base.skillGroups }),
  }
}

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
  return fromObject({ parsed, base: DEFAULT_GLOBAL_SETTINGS })
}

// Apply a partial patch over current settings. Invalid field values are ignored
// (current value wins), reusing the same per-field validation as parse so a bad
// request can't corrupt stored state.
export const mergeGlobalSettings = (input: {
  readonly current: GlobalSettings
  readonly patch: GlobalSettingsPatch | null | undefined
}): GlobalSettings => {
  const { current, patch } = input
  if (!isObject(patch)) return current
  return fromObject({ parsed: patch as Record<string, unknown>, base: current })
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
