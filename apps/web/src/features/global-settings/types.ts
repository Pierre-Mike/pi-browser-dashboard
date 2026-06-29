// Global dashboard settings, served by the daemon at GET/POST /settings.
// Mirrors apps/daemon/src/features/global-settings/global-settings.core.ts.

// A named, reusable set of skills the spawn modal can apply in one click.
export type SkillGroup = {
  readonly name: string
  readonly skills: readonly string[]
}

export type GlobalSettings = {
  readonly git: { readonly defaultBranch: string; readonly remoteName: string }
  readonly library: { readonly catalogPath: string; readonly agenticRepoPath: string }
  readonly orchestration: {
    readonly claudeBin: string
    readonly defaultAgent: string
    readonly defaultPermissionMode: string
    readonly defaultEffort: string
    readonly maxParallel: number
  }
  readonly network: {
    readonly projectsRoot: string
    readonly appPort: number
    readonly tunnelPort: number
  }
  readonly skillGroups: readonly SkillGroup[]
}

export type GlobalSettingsPatch = {
  readonly git?: Partial<GlobalSettings["git"]>
  readonly library?: Partial<GlobalSettings["library"]>
  readonly orchestration?: Partial<GlobalSettings["orchestration"]>
  readonly network?: Partial<GlobalSettings["network"]>
  // A list, not a partial: providing it replaces the whole stored set.
  readonly skillGroups?: readonly SkillGroup[]
}
