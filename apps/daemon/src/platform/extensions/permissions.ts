import type { ExtensionManifest, ExtensionPermissions } from "./manifest"

export type GrantResult = { ok: true } | { ok: false; missing: string[] }

// A requested string is covered when the granted list contains "*" or the
// exact requested string. Kept deliberately simple for Phase 1.
const covers = (granted: string[] | undefined, requested: string): boolean => {
  if (!granted) return false
  return granted.includes("*") || granted.includes(requested)
}

const checkList = (
  cap: "fs" | "exec" | "net",
  requested: string[] | undefined,
  granted: string[] | undefined,
  missing: string[],
): void => {
  if (!requested) return
  for (const r of requested) {
    if (!covers(granted, r)) missing.push(`${cap}:${r}`)
  }
}

export const checkGrants = (
  manifest: ExtensionManifest,
  granted: ExtensionPermissions,
): GrantResult => {
  const req = manifest.permissions
  if (!req) return { ok: true }

  const missing: string[] = []
  checkList("fs", req.fs, granted.fs, missing)
  checkList("exec", req.exec, granted.exec, missing)
  checkList("net", req.net, granted.net, missing)
  if (req.events && !granted.events) missing.push("events")

  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
