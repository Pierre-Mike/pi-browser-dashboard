// Mirror of daemon ClaudeConfig types. Kept narrow — only what the UI renders.

export type HookEntry = {
  event: string
  matcher?: string
  command: string
  type?: string
  timeout?: number
  async?: boolean
  statusMessage?: string
}

export type HookScript = {
  name: string
  path: string
  bytes: number
}

export type SkillSummary = {
  id: string
  path: string
  name: string
  description?: string
  bytes: number
  hasEvals: boolean
}

export type SkillFrontmatter = {
  name?: string
  description?: string
  metadata?: Record<string, unknown>
}

export type SkillDetail = SkillSummary & {
  body: string
  frontmatter: SkillFrontmatter
}

export type SettingsSummary = {
  hooks: HookEntry[]
  permissions?: {
    allow?: string[]
    deny?: string[]
    ask?: string[]
    defaultMode?: string
    additionalDirectories?: string[]
  }
  theme?: string
  statusLine?: unknown
  enabledPlugins?: Record<string, unknown>
  extras: Record<string, unknown>
  raw: string
  parseError?: string
}

export type ScopeBundle = {
  scope: "global" | "project"
  root: string
  settings?: SettingsSummary
  settingsLocal?: SettingsSummary
  skills: SkillSummary[]
  hookScripts: HookScript[]
  hooks: HookEntry[]
  claudeMd?: string
}
