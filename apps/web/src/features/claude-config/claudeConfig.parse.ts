// Runtime decoders for `ScopeBundle` / `SkillDetail` — no `@pid/shared`
// contract exists for these shapes, so they are validated locally instead of
// trusted with an `as`.
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  parseArray,
} from "../../lib/guards"
import type {
  HookEntry,
  HookScript,
  ScopeBundle,
  SettingsSummary,
  SkillDetail,
  SkillFrontmatter,
  SkillSummary,
} from "./types"

// The optional half of a hook entry, read separately so neither this nor
// `parseHookEntry` carries the whole field count on its own — a validator's
// cyclomatic complexity grows one branch per field, and `bun run audit` grades
// it. Splitting on required-vs-optional is the natural seam.
type HookOptionals = Pick<HookEntry, "matcher" | "type" | "timeout" | "async" | "statusMessage">

// Flat, no nesting: one guard per optional wire field, values flowing straight
// into the returned object. Cyclomatic complexity counts two branches per
// optional field (`absent?` plus `right type?`), so five fields alone clear the
// ceiling while cognitive complexity — the metric that tracks nesting — sits at
// the threshold. The alternatives are a key-table loop that needs an `as` to
// re-attach field names, or one function per field; both check exactly the same
// things and read worse. Suppressed deliberately.
// fallow-ignore-next-line complexity
const parseHookOptionals = (v: Record<string, unknown>): HookOptionals | null => {
  const { matcher, type, timeout, async, statusMessage } = v
  if (matcher !== undefined && !isString(matcher)) return null
  if (type !== undefined && !isString(type)) return null
  if (timeout !== undefined && !isNumber(timeout)) return null
  if (async !== undefined && !isBoolean(async)) return null
  if (statusMessage !== undefined && !isString(statusMessage)) return null
  return { matcher, type, timeout, async, statusMessage }
}

const parseHookEntry = (v: unknown): HookEntry | null => {
  if (!isRecord(v)) return null
  const { event, command } = v
  if (!isString(event) || !isString(command)) return null
  const optionals = parseHookOptionals(v)
  if (!optionals) return null
  return { event, command, ...optionals }
}

const parseHookScript = (v: unknown): HookScript | null => {
  if (!isRecord(v)) return null
  const { name, path, bytes } = v
  return isString(name) && isString(path) && isNumber(bytes) ? { name, path, bytes } : null
}

const parseSkillSummary = (v: unknown): SkillSummary | null => {
  if (!isRecord(v)) return null
  const { id, path, name, description, bytes, hasEvals } = v
  if (!isString(id) || !isString(path) || !isString(name)) return null
  if (description !== undefined && !isString(description)) return null
  if (!isNumber(bytes) || !isBoolean(hasEvals)) return null
  return { id, path, name, description, bytes, hasEvals }
}

// `permissions`/`statusLine`/`enabledPlugins`/`extras` are already typed as
// loosely as the daemon itself models them (optional arrays of strings, or
// `Record<string, unknown>`) — validated as such, not re-derived deeper.
//
// The nested `permissions` object is read by its own function: nesting a
// five-field validator inside an eight-field one is what pushed this over the
// complexity ceiling, and the object boundary is the honest seam.
type Permissions = NonNullable<SettingsSummary["permissions"]>

// Flat, no nesting: one guard per optional wire field, values flowing straight
// into the returned object. Cyclomatic complexity counts two branches per
// optional field (`absent?` plus `right type?`), so five fields alone clear the
// ceiling while cognitive complexity — the metric that tracks nesting — sits at
// the threshold. The alternatives are a key-table loop that needs an `as` to
// re-attach field names, or one function per field; both check exactly the same
// things and read worse. Suppressed deliberately.
// fallow-ignore-next-line complexity
const parsePermissions = (v: unknown): Permissions | null => {
  if (!isRecord(v)) return null
  const { allow, deny, ask, defaultMode, additionalDirectories } = v
  if (allow !== undefined && !isStringArray(allow)) return null
  if (deny !== undefined && !isStringArray(deny)) return null
  if (ask !== undefined && !isStringArray(ask)) return null
  if (defaultMode !== undefined && !isString(defaultMode)) return null
  if (additionalDirectories !== undefined && !isStringArray(additionalDirectories)) return null
  return { allow, deny, ask, defaultMode, additionalDirectories }
}

// The optional scalars, read together for the same reason the hook entry splits
// its own: one branch per field adds up, and required-vs-optional is the seam
// that keeps each function readable.
type SettingsOptionals = Pick<SettingsSummary, "theme" | "enabledPlugins" | "parseError">

const parseSettingsOptionals = (v: Record<string, unknown>): SettingsOptionals | null => {
  const { theme, enabledPlugins, parseError } = v
  if (theme !== undefined && !isString(theme)) return null
  if (parseError !== undefined && !isString(parseError)) return null
  if (enabledPlugins !== undefined && !isRecord(enabledPlugins)) return null
  return { theme, enabledPlugins, parseError }
}

const parseSettingsSummary = (v: unknown): SettingsSummary | null => {
  if (!isRecord(v)) return null
  const { hooks, permissions, statusLine, extras, raw } = v
  const parsedHooks = parseArray(hooks, parseHookEntry)
  if (!parsedHooks) return null
  if (!isRecord(extras) || !isString(raw)) return null

  const optionals = parseSettingsOptionals(v)
  if (!optionals) return null

  const parsedPermissions = permissions === undefined ? undefined : parsePermissions(permissions)
  if (parsedPermissions === null) return null

  return {
    hooks: parsedHooks,
    permissions: parsedPermissions,
    statusLine,
    extras,
    raw,
    ...optionals,
  }
}

export const parseScopeBundle = (v: unknown): ScopeBundle | null => {
  if (!isRecord(v)) return null
  const { scope, root, settings, settingsLocal, skills, hookScripts, hooks, claudeMd } = v
  if (scope !== "global" && scope !== "project") return null
  if (!isString(root)) return null
  if (claudeMd !== undefined && !isString(claudeMd)) return null

  const parsedSkills = parseArray(skills, parseSkillSummary)
  const parsedHookScripts = parseArray(hookScripts, parseHookScript)
  const parsedHooks = parseArray(hooks, parseHookEntry)
  if (!parsedSkills || !parsedHookScripts || !parsedHooks) return null

  let parsedSettings: SettingsSummary | undefined
  if (settings !== undefined) {
    const s = parseSettingsSummary(settings)
    if (!s) return null
    parsedSettings = s
  }
  let parsedSettingsLocal: SettingsSummary | undefined
  if (settingsLocal !== undefined) {
    const s = parseSettingsSummary(settingsLocal)
    if (!s) return null
    parsedSettingsLocal = s
  }

  return {
    scope,
    root,
    settings: parsedSettings,
    settingsLocal: parsedSettingsLocal,
    skills: parsedSkills,
    hookScripts: parsedHookScripts,
    hooks: parsedHooks,
    claudeMd,
  }
}

const parseSkillFrontmatter = (v: unknown): SkillFrontmatter | null => {
  if (!isRecord(v)) return null
  const { name, description, metadata } = v
  if (name !== undefined && !isString(name)) return null
  if (description !== undefined && !isString(description)) return null
  if (metadata !== undefined && !isRecord(metadata)) return null
  return { name, description, metadata }
}

export const parseSkillDetail = (v: unknown): SkillDetail | null => {
  const summary = parseSkillSummary(v)
  if (!summary || !isRecord(v)) return null
  const { body, frontmatter } = v
  if (!isString(body)) return null
  const parsedFrontmatter = parseSkillFrontmatter(frontmatter)
  if (!parsedFrontmatter) return null
  return { ...summary, body, frontmatter: parsedFrontmatter }
}
