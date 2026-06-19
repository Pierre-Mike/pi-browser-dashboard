export type ExtensionTier = "iframe" | "esm"

export type ExtensionContributes = {
  tabs?: unknown[]
  projectPanels?: unknown[]
  cards?: unknown[]
  panels?: unknown[]
  commands?: unknown[]
}

export type ExtensionScope = "global" | "local"

// Shape returned by GET /extensions — sanitized (no permission values).
export type ExtensionManifest = {
  name: string
  version: string
  tier: ExtensionTier
  contributes?: ExtensionContributes
  permissions: string[]
  scope: ExtensionScope
  // Present only for local extensions: the repo root that owns the extension.
  // The dashboard renders a local ext's project panel only on this project.
  projectPath?: string
  requested: string[]
  granted: string[]
  enabled: boolean
}
