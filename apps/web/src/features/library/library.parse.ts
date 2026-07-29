// Runtime decoders for the library endpoints in useLibrary.ts — no
// `@pid/shared` contract exists for these shapes, so they are validated
// locally instead of trusted with an `as`.
import { isBoolean, isRecord, isString, isStringArray, parseArray } from "../../lib/guards"
import {
  type AgenticItem,
  type AgenticListing,
  type Catalog,
  type CatalogBundle,
  type InitResult,
  type InstallResult,
  type InstallStatus,
  LIBRARY_CATEGORIES,
  type LibraryCategory,
  type LibraryEntry,
  type ScopeDirs,
  type StatusByScope,
  type SyncOutcome,
} from "./types"

const isLibraryCategory = (v: unknown): v is LibraryCategory =>
  isString(v) && (LIBRARY_CATEGORIES as readonly string[]).includes(v)

const isInstallStatus = (v: unknown): v is InstallStatus =>
  v === "installed" || v === "not_installed"

const parseLibraryEntry = (v: unknown): LibraryEntry | null => {
  if (!isRecord(v)) return null
  const { name, type, description, source, requires } = v
  if (!isString(name) || !isLibraryCategory(type) || !isString(description) || !isString(source))
    return null
  if (requires !== undefined && !isStringArray(requires)) return null
  return { name, type, description, source, requires }
}

const parseScopeDirs = (v: unknown): ScopeDirs | null => {
  if (!isRecord(v)) return null
  const { default: def, global } = v
  return isString(def) && isString(global) ? { default: def, global } : null
}

const parseDefaultDirs = (v: unknown): Catalog["defaultDirs"] | null => {
  if (!isRecord(v)) return null
  const out: Partial<Record<LibraryCategory, ScopeDirs>> = {}
  for (const category of LIBRARY_CATEGORIES) {
    const dirs = parseScopeDirs(v[category])
    if (!dirs) return null
    out[category] = dirs
  }
  // Every key in LIBRARY_CATEGORIES was just set above (or the loop returned
  // null) — the `Partial` is complete here; TS can't see that from the loop.
  return out as Catalog["defaultDirs"]
}

const parseCatalog = (v: unknown): Catalog | null => {
  if (!isRecord(v)) return null
  const defaultDirs = parseDefaultDirs(v.defaultDirs)
  const entries = parseArray(v.entries, parseLibraryEntry)
  return defaultDirs && entries ? { defaultDirs, entries } : null
}

const parseStatusByScope = (v: unknown): StatusByScope | null => {
  if (!isRecord(v)) return null
  const { global, local } = v
  return isInstallStatus(global) && isInstallStatus(local) ? { global, local } : null
}

const parseStatusByName = (v: unknown): Record<string, StatusByScope> | null => {
  if (!isRecord(v)) return null
  const out: Record<string, StatusByScope> = {}
  for (const [name, status] of Object.entries(v)) {
    const parsed = parseStatusByScope(status)
    if (!parsed) return null
    out[name] = parsed
  }
  return out
}

export const parseCatalogBundle = (v: unknown): CatalogBundle | null => {
  if (!isRecord(v)) return null
  const catalog = parseCatalog(v.catalog)
  const statusByName = parseStatusByName(v.statusByName)
  return catalog && isString(v.catalogPath) && statusByName
    ? { catalog, catalogPath: v.catalogPath, statusByName }
    : null
}

const parseAgenticItem = (v: unknown): AgenticItem | null => {
  if (!isRecord(v)) return null
  const { name, path, registered } = v
  return isString(name) && isString(path) && isBoolean(registered)
    ? { name, path, registered }
    : null
}

export const parseAgenticListing = (v: unknown): AgenticListing | null => {
  if (!isRecord(v)) return null
  const { repoPath, category, items } = v
  if (!isString(repoPath) || !isLibraryCategory(category)) return null
  const parsedItems = parseArray(items, parseAgenticItem)
  return parsedItems ? { repoPath, category, items: parsedItems } : null
}

export const parseInitResult = (v: unknown): InitResult | null => {
  if (!isRecord(v)) return null
  return isString(v.catalogPath) ? { catalogPath: v.catalogPath } : null
}

export const parseInstallResult = (v: unknown): InstallResult | null => {
  if (!isRecord(v)) return null
  const { installed, destinations } = v
  return isStringArray(installed) && isStringArray(destinations)
    ? { installed, destinations }
    : null
}

export const parseEntryWrapper = (v: unknown): { entry: LibraryEntry } | null => {
  if (!isRecord(v)) return null
  const entry = parseLibraryEntry(v.entry)
  return entry ? { entry } : null
}

export const parseCommitShaWrapper = (v: unknown): { commitSha: string } | null => {
  if (!isRecord(v)) return null
  return isString(v.commitSha) ? { commitSha: v.commitSha } : null
}

export const parseRemovedWrapper = (v: unknown): { removed: boolean } | null => {
  if (!isRecord(v)) return null
  return isBoolean(v.removed) ? { removed: v.removed } : null
}

const parseSyncOutcome = (v: unknown): SyncOutcome | null => {
  if (!isRecord(v)) return null
  const { name, type, scope, ok, error } = v
  if (!isString(name) || !isLibraryCategory(type)) return null
  if (scope !== "global" && scope !== "local") return null
  if (!isBoolean(ok)) return null
  if (error !== undefined && !isString(error)) return null
  return { name, type, scope, ok, error }
}

export const parseOutcomesWrapper = (v: unknown): { outcomes: SyncOutcome[] } | null => {
  if (!isRecord(v)) return null
  const outcomes = parseArray(v.outcomes, parseSyncOutcome)
  return outcomes ? { outcomes } : null
}

// `httpErrorBody`'s failure-path payload — `{ error, message? }` on a known
// daemon error, or anything else, which falls back to a status-based message.
export const parseErrorBody = (v: unknown): { error?: string; message?: string } => {
  if (!isRecord(v)) return {}
  const { error, message } = v
  return {
    error: isString(error) ? error : undefined,
    message: isString(message) ? message : undefined,
  }
}
