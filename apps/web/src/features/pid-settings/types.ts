// Per-project pid settings, served by the daemon at /pid-settings/projects/:id.
// Mirrors apps/daemon/src/features/pid-settings/pid-settings.core.ts. Small to
// start (just the default selected skills) but designed to grow.
export type PidSettings = {
  readonly defaultSkills: readonly string[]
}

export type PidSettingsPatch = {
  readonly defaultSkills?: readonly string[]
}
