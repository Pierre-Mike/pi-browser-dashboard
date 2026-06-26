// Global dashboard settings, served by the daemon at GET/POST /settings.
// Mirrors apps/daemon/src/features/global-settings/global-settings.core.ts.
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
}

export type GlobalSettingsPatch = {
  readonly git?: Partial<GlobalSettings["git"]>
  readonly library?: Partial<GlobalSettings["library"]>
  readonly orchestration?: Partial<GlobalSettings["orchestration"]>
  readonly network?: Partial<GlobalSettings["network"]>
}
