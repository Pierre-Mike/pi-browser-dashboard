import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ExtensionPermissions } from "./manifest"

export type ExtensionGrants = {
  fs?: string[]
  exec?: string[]
  net?: string[]
  events?: boolean
}

export type ExtensionState = Record<string, { enabled: boolean; grants: ExtensionGrants }>

export const defaultStateFile = (): string =>
  process.env.PID_EXT_STATE_FILE ?? join(homedir(), ".pid/extensions-state.json")

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

export const setEnabled = (file: string, name: string, enabled: boolean): ExtensionState => {
  const state = readState(file)
  state[name] = { enabled, grants: state[name]?.grants ?? {} }
  writeState(file, state)
  return state
}

export const setGrants = (file: string, name: string, grants: ExtensionGrants): ExtensionState => {
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
