import type { Hono } from "hono"
import type { ExtensionManifest } from "./manifest"

export type ExtensionScope = "global" | "local"

export type LoadedExtension = {
  readonly manifest: ExtensionManifest
  readonly dir: string
  readonly app?: Hono
  readonly scope: ExtensionScope
}

export type ExtensionMount = {
  readonly basePath: string
  readonly app: Hono
}

export type ExtensionRegistry = {
  readonly register: (entry: LoadedExtension) => void
  readonly list: () => readonly LoadedExtension[]
  readonly get: (name: string) => LoadedExtension | undefined
  readonly mounts: () => readonly ExtensionMount[]
  readonly clear: () => void
}

export const createRegistry = (): ExtensionRegistry => {
  // Keyed by name so a later register (e.g. local) replaces an earlier one
  // (e.g. global) of the same name; each name is listed exactly once.
  const byName = new Map<string, LoadedExtension>()
  return {
    register: (entry) => {
      byName.set(entry.manifest.name, entry)
    },
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
    mounts: () => {
      const out: ExtensionMount[] = []
      for (const e of byName.values()) {
        if (e.app) out.push({ basePath: `/ext/${e.manifest.name}`, app: e.app })
      }
      return out
    },
    clear: () => {
      byName.clear()
    },
  }
}

export const extensionRegistry: ExtensionRegistry = createRegistry()
