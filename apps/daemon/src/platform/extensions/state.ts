import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ExtensionPermissions } from "./manifest"
import type { ExtensionScope } from "./registry"

export type ExtensionGrants = {
  fs?: string[]
  exec?: string[]
  net?: string[]
  events?: boolean
}

export type ExtensionState = Record<string, { enabled: boolean; grants: ExtensionGrants }>

// Resolve the state file that holds an extension's enabled/grants record.
//
// State is scoped to match where the extension lives, so a LOCAL extension's
// enable-state and permission grants stay with its project instead of leaking
// into a same-named local extension in another project:
//   - global → ~/.pid/extensions-state.json (shared, by design)
//   - local  → <project>/.pid/extensions-state.json (per-project)
// The extension dir is <project>/.pid/extensions/<name>, so the project's
// .pid directory is two levels up. PID_EXT_STATE_FILE, when set, overrides
// both scopes (used by tests and single-file deployments).
export const stateFileFor = (entry: { scope: ExtensionScope; dir: string }): string => {
  const override = process.env.PID_EXT_STATE_FILE
  if (override) return override
  if (entry.scope === "local") {
    return join(dirname(dirname(entry.dir)), "extensions-state.json")
  }
  return join(homedir(), ".pid/extensions-state.json")
}

export const readState = (file: string): ExtensionState => {
  if (!existsSync(file)) return {}
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    return parsed as ExtensionState
  } catch {
    return {}
  }
}

export const writeState = (file: string, state: ExtensionState): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2))
}

export const setEnabled = ({
  file,
  name,
  enabled,
}: {
  file: string
  name: string
  enabled: boolean
}): ExtensionState => {
  const state = readState(file)
  state[name] = { enabled, grants: state[name]?.grants ?? {} }
  writeState(file, state)
  return state
}

export const setGrants = ({
  file,
  name,
  grants,
}: {
  file: string
  name: string
  grants: ExtensionGrants
}): ExtensionState => {
  const state = readState(file)
  state[name] = { enabled: state[name]?.enabled ?? true, grants }
  writeState(file, state)
  return state
}

export const isEnabled = (state: ExtensionState, name: string): boolean =>
  state[name]?.enabled ?? true

export const grantsFor = (state: ExtensionState, name: string): ExtensionGrants =>
  state[name]?.grants ?? {}

export const grantsAsPermissions = (grants: ExtensionGrants): ExtensionPermissions => grants

export const permissionKeysFromGrants = (grants: ExtensionGrants): string[] => {
  const keys: string[] = []
  if (grants.fs && grants.fs.length > 0) keys.push("fs")
  if (grants.exec && grants.exec.length > 0) keys.push("exec")
  if (grants.net && grants.net.length > 0) keys.push("net")
  if (grants.events) keys.push("events")
  return keys
}
