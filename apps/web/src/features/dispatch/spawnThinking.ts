// Thinking levels accepted by `pi --thinking` — pi's counterpart to
// `claude --effort` (the two harnesses name and scale the knob differently,
// so they get separate modules). The empty string is the UI default —
// "inherit", meaning we send no `--thinking` flag. Source: `pi --help` (v0.80).
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const

export type SpawnThinking = (typeof PI_THINKING_LEVELS)[number]

export const DEFAULT_SPAWN_THINKING = "" as const

// Narrow an arbitrary string to a valid thinking level, or undefined when it
// is the inherit default / anything unrecognised — so we never forward a bogus
// `--thinking` value to pi.
export const normalizeThinking = (value: string): SpawnThinking | undefined =>
  (PI_THINKING_LEVELS as readonly string[]).includes(value) ? (value as SpawnThinking) : undefined
