// The spawn modal can dispatch to two harnesses: Claude Code (`claude --bg`,
// the default) and the pi coding agent (`pi -p`, detached). Everything
// harness-specific the modal branches on lives here so the tabs, pickers, and
// dispatch body can't drift apart.

export const SPAWN_HARNESSES = ["claude", "pi"] as const

export type SpawnHarness = (typeof SPAWN_HARNESSES)[number]

export const DEFAULT_SPAWN_HARNESS: SpawnHarness = "claude"

// The same skill picker feeds both harnesses; only the slash-command shape
// differs. Claude Code invokes a skill as `/name`, pi as `/skill:name`
// (pi reserves bare `/name` for prompt templates).
export const HARNESS_SKILL_PREFIXES: Record<SpawnHarness, string> = {
  claude: "/",
  pi: "/skill:",
}

export const HARNESS_LABELS: Record<SpawnHarness, string> = {
  claude: "Claude",
  pi: "pi",
}

// Narrow an arbitrary string to a harness, falling back to the default so a
// stale or bogus value can never leave the modal in an unknown mode.
export const normalizeHarness = (value: string): SpawnHarness =>
  (SPAWN_HARNESSES as readonly string[]).includes(value) ? (value as SpawnHarness) : "claude"
