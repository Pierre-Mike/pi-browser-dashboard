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
}
