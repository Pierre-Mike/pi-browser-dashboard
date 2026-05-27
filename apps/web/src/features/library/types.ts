// Mirror of daemon Library types. Kept narrow — only what the UI renders.

export const LIBRARY_CATEGORIES = [
  "skills",
  "agents",
  "tools",
  "prompts",
  "statuslines",
  "extensions",
] as const
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]

export type LibraryEntry = {
  name: string
  type: LibraryCategory
  description: string
  source: string
  requires?: string[]
}

export type ScopeDirs = { default: string; global: string }

export type Catalog = {
  defaultDirs: Record<LibraryCategory, ScopeDirs>
  entries: LibraryEntry[]
}

export type InstallStatus = "installed" | "not_installed"
export type StatusByScope = { global: InstallStatus; local: InstallStatus }

export type CatalogBundle = {
  catalog: Catalog
  catalogPath: string
  statusByName: Record<string, StatusByScope>
}

export type AgenticItem = {
  name: string
  path: string
  registered: boolean
}

export type AgenticListing = {
  repoPath: string
  category: LibraryCategory
  items: AgenticItem[]
}

export type InstallScope = "global" | "local"

export type InstallInput = {
  name: string
  type: LibraryCategory
  scope: InstallScope
  projectId?: string | null
}

export type InstallResult = {
  installed: string[]
  destinations: string[]
}

export type AddInput = {
  name: string
  type: LibraryCategory
  description: string
  source: string
  requires?: string[]
}

export type RemoveInput = {
  name: string
  type: LibraryCategory
  deleteLocal: boolean
  scope: InstallScope
  projectId?: string | null
}

export type PushInput = {
  name: string
  type: LibraryCategory
  scope: InstallScope
  projectId?: string | null
}

export type SyncInput = {
  scope?: InstallScope
  projectId?: string | null
}

export type SyncOutcome = {
  name: string
  type: LibraryCategory
  scope: InstallScope
  ok: boolean
  error?: string
}
