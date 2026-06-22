// Reasoning effort levels accepted by `claude --effort`. The empty string is the
// UI default — "inherit", meaning we send no `--effort` flag and the session
// uses its own default. Kept in one place so the picker and the dispatch body
// can't drift from the daemon's accepted values.
export const SPAWN_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const

export type SpawnEffort = (typeof SPAWN_EFFORT_LEVELS)[number]

export const DEFAULT_SPAWN_EFFORT = "" as const

// Narrow an arbitrary string to a valid effort level, or undefined when it is
// the inherit default / anything unrecognised. Used to build the dispatch body
// so we never forward a bogus `--effort` value to the CLI.
export const normalizeEffort = (value: string): SpawnEffort | undefined =>
  (SPAWN_EFFORT_LEVELS as readonly string[]).includes(value) ? (value as SpawnEffort) : undefined
