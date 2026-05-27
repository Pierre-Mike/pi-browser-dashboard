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
