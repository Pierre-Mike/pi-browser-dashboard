import { join } from "node:path"
import { loadExtensions } from "./loader"
import type { LoadExtensionsOptions } from "./loader"
import { createRegistry } from "./registry"
import type { LoadedExtension } from "./registry"

// Per-project local extension discovery.
//
// Local extensions live in `<projectPath>/.pid/extensions/<name>` and read
// their enable/grant state from `<projectPath>/.pid/extensions-state.json`
// (resolved by the loader's stateFileFor for local scope). Unlike globals —
// which are scanned once at boot into the shared registry — locals are
// discovered on demand per project so a freshly-installed local panel shows up
// without a daemon restart, and a panel installed into project A never leaks
// into project B.
//
// Results are cached briefly per project path: a burst of requests (panel list
// + iframe asset fetches) for the same project reuses one scan, while the short
// TTL keeps new installs visible within seconds.

const TTL_MS = 3_000

type CacheEntry = { at: number; exts: readonly LoadedExtension[] }
const cache = new Map<string, CacheEntry>()

export const clearProjectExtensionsCache = (): void => {
  cache.clear()
}

export type ResolveProjectExtensionsOptions = {
  now?: number
  // Test seam: override the loader (e.g. to stub state/importer). Defaults to
  // the real loader scanning the project's local extensions dir only.
  load?: (opts: LoadExtensionsOptions) => Promise<unknown>
}

export const resolveProjectExtensions = async (
  projectPath: string,
  opts: ResolveProjectExtensionsOptions = {},
): Promise<readonly LoadedExtension[]> => {
  const now = opts.now ?? Date.now()
  const hit = cache.get(projectPath)
  if (hit && now - hit.at < TTL_MS) return hit.exts

  const registry = createRegistry()
  const load = opts.load ?? loadExtensions
  await load({
    // global:null — globals are owned by the shared registry, not re-scanned
    // here. Only this project's local dir is scanned.
    roots: { global: null, local: join(projectPath, ".pid", "extensions") },
    registry,
  })
  const exts = registry.list()
  cache.set(projectPath, { at: now, exts })
  return exts
}
