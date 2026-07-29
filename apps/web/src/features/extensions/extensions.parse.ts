// Runtime decoder for `ExtensionManifest` — no `@pid/shared` contract exists
// for this shape, so it is validated locally instead of trusted with an `as`.
import { isBoolean, isRecord, isString, isStringArray, parseArray } from "../../lib/guards"
import type {
  ExtensionContributes,
  ExtensionManifest,
  ExtensionScope,
  ExtensionTier,
} from "./types"

const isTier = (v: unknown): v is ExtensionTier => v === "iframe" || v === "esm"
const isScope = (v: unknown): v is ExtensionScope => v === "global" || v === "local"

// Every field here is already typed `unknown[]` on `ExtensionContributes` —
// the contribution payloads vary per extension and are rendered by whichever
// component owns that contribution point, so this only checks "is an array",
// not what's inside it.
const arrayOrUndefined = (v: unknown): unknown[] | undefined => (Array.isArray(v) ? v : undefined)

const parseContributes = (v: unknown): ExtensionContributes | undefined => {
  if (!isRecord(v)) return undefined
  return {
    tabs: arrayOrUndefined(v.tabs),
    projectPanels: arrayOrUndefined(v.projectPanels),
    cards: arrayOrUndefined(v.cards),
    panels: arrayOrUndefined(v.panels),
    commands: arrayOrUndefined(v.commands),
  }
}

export const parseExtensionManifest = (v: unknown): ExtensionManifest | null => {
  if (!isRecord(v)) return null
  const { name, version, tier, permissions, scope, projectPath, requested, granted, enabled } = v
  if (!isString(name) || !isString(version)) return null
  if (!isTier(tier) || !isScope(scope)) return null
  if (!isStringArray(permissions) || !isStringArray(requested) || !isStringArray(granted))
    return null
  if (!isBoolean(enabled)) return null
  if (projectPath !== undefined && !isString(projectPath)) return null
  return {
    name,
    version,
    tier,
    contributes: parseContributes(v.contributes),
    permissions,
    scope,
    projectPath,
    requested,
    granted,
    enabled,
  }
}

export const parseExtensionManifests = (v: unknown): ExtensionManifest[] | null =>
  parseArray(v, parseExtensionManifest)
