// Pure parsers/mergers for per-project pid settings (<project>/.pid/settings.json).
// No I/O — file reads/writes live in pid-settings.repo.ts.
//
// The schema is intentionally small to start (just the default selected skills
// for the spawn modal) but is designed to grow: parse fills missing/invalid
// fields from DEFAULT_PID_SETTINGS, and merge applies a partial patch so new
// keys can be added without a migration.

export type PidSettings = {
  // Skills pre-selected in the spawn modal for this project, in order.
  readonly defaultSkills: readonly string[]
}

export const DEFAULT_PID_SETTINGS: PidSettings = {
  defaultSkills: ["goal"],
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Keep only non-empty string entries, deduped, order preserved. Whitespace is
// trimmed; a leading slash (`/goal`) is stripped so the stored id matches the
// picker's bare-id form.
const normalizeSkills = (raw: unknown): readonly string[] | null => {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== "string") continue
    const id = v.trim().replace(/^\/+/, "")
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Parse a settings.json text into a fully-populated PidSettings. Empty, missing,
// malformed JSON, or wrong-typed fields all fall back to defaults field-by-field
// so a hand-edited or partial file never throws and never loses unknown intent.
export const parsePidSettings = (text: string | null | undefined): PidSettings => {
  if (text == null || text.trim() === "") return DEFAULT_PID_SETTINGS
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return DEFAULT_PID_SETTINGS
  }
  if (!isObject(parsed)) return DEFAULT_PID_SETTINGS
  const defaultSkills = normalizeSkills(parsed.defaultSkills)
  return {
    defaultSkills: defaultSkills ?? DEFAULT_PID_SETTINGS.defaultSkills,
  }
}

export type PidSettingsPatch = {
  readonly defaultSkills?: readonly string[]
}

// Apply a partial patch over current settings. Invalid field values in the patch
// are ignored (current value wins) so a bad request can't corrupt stored state.
export const mergePidSettings = (
  current: PidSettings,
  patch: PidSettingsPatch | null | undefined,
): PidSettings => {
  if (!isObject(patch)) return current
  const defaultSkills =
    patch.defaultSkills !== undefined ? normalizeSkills(patch.defaultSkills) : null
  return {
    defaultSkills: defaultSkills ?? current.defaultSkills,
  }
}

export const serializePidSettings = (s: PidSettings): string => `${JSON.stringify(s, null, 2)}\n`
