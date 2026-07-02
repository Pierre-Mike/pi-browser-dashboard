// Model aliases accepted by `claude --model` (per `claude --help`: "Provide an
// alias for the latest model ... or a model's full name"). The empty string is
// the UI default — "inherit", meaning we send no `--model` flag and the
// session uses its own default. Kept in one place so the picker and the
// dispatch body can't drift from the daemon's accepted values.
export const SPAWN_MODEL_ALIASES = ["opus", "sonnet", "haiku", "fable"] as const

export type SpawnModel = (typeof SPAWN_MODEL_ALIASES)[number]

export const DEFAULT_SPAWN_MODEL = "" as const

// Narrow an arbitrary string to a valid model alias, or undefined when it is
// the inherit default / anything unrecognised. Used to build the dispatch body
// so we never forward a bogus `--model` value to the CLI.
export const normalizeModel = (value: string): SpawnModel | undefined =>
  (SPAWN_MODEL_ALIASES as readonly string[]).includes(value) ? (value as SpawnModel) : undefined
