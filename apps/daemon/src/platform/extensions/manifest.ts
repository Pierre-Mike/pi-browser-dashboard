export type ExtensionTier = "iframe" | "esm"

export type ExtensionPermissions = {
  fs?: string[]
  exec?: string[]
  net?: string[]
  events?: boolean
  // Read-only repo introspection (git status / log) via the scoped daemon API.
  git?: boolean
}

export type ExtensionContributes = {
  tabs?: unknown[]
  projectPanels?: unknown[]
  cards?: unknown[]
  panels?: unknown[]
  commands?: unknown[]
}

export type ExtensionManifest = {
  name: string
  version: string
  tier: ExtensionTier
  contributes?: ExtensionContributes
  permissions?: ExtensionPermissions
  daemonEntry?: string
  ui?: string
}

export type ParseResult = { ok: true; value: ExtensionManifest } | { ok: false; error: string }

const TIERS: ReadonlySet<string> = new Set<ExtensionTier>(["iframe", "esm"])
// name is used as a path segment, so disallow slashes, dots-leading, traversal.
// Exported so the pid-apps feature reuses the same identifier rule (no redefine).
export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export const parseManifest = (raw: unknown): ParseResult => {
  if (!isRecord(raw)) return { ok: false, error: "manifest must be an object" }

  const name = raw.name
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, error: "manifest.name must be a non-empty string" }
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return { ok: false, error: "manifest.name must not contain path separators or '..'" }
  }
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      error: "manifest.name must match /^[a-z0-9][a-z0-9._-]*$/ (lowercase, no slashes)",
    }
  }

  const version = raw.version
  if (typeof version !== "string" || version.length === 0) {
    return { ok: false, error: "manifest.version must be a non-empty string" }
  }

  const tier = raw.tier
  if (typeof tier !== "string" || !TIERS.has(tier)) {
    return { ok: false, error: "manifest.tier must be one of: iframe, esm" }
  }

  const daemonEntryRaw = raw.daemonEntry
  if (daemonEntryRaw !== undefined && typeof daemonEntryRaw !== "string") {
    return { ok: false, error: "manifest.daemonEntry must be a string" }
  }
  const daemonEntry = daemonEntryRaw ?? "daemon.ts"

  const uiRaw = raw.ui
  if (uiRaw !== undefined && typeof uiRaw !== "string") {
    return { ok: false, error: "manifest.ui must be a string" }
  }

  const value: ExtensionManifest = {
    name,
    version,
    tier: tier as ExtensionTier,
    daemonEntry,
  }
  if (uiRaw !== undefined) value.ui = uiRaw
  if (isRecord(raw.contributes)) value.contributes = raw.contributes as ExtensionContributes
  if (isRecord(raw.permissions)) value.permissions = raw.permissions as ExtensionPermissions

  return { ok: true, value }
}

export type SanitizedManifest = {
  name: string
  version: string
  tier: ExtensionTier
  contributes?: ExtensionContributes
  permissions: string[]
}

// Expose a manifest over HTTP without leaking permission VALUES (fs/exec paths,
// net hosts). Only the requested capability KEYS are surfaced.
export const sanitizeManifest = (m: ExtensionManifest): SanitizedManifest => {
  const keys: string[] = []
  const p = m.permissions
  if (p) {
    if (p.fs && p.fs.length > 0) keys.push("fs")
    if (p.exec && p.exec.length > 0) keys.push("exec")
    if (p.net && p.net.length > 0) keys.push("net")
    if (p.events) keys.push("events")
    if (p.git) keys.push("git")
  }
  const out: SanitizedManifest = {
    name: m.name,
    version: m.version,
    tier: m.tier,
    permissions: keys,
  }
  if (m.contributes) out.contributes = m.contributes
  return out
}
