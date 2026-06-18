import { useEffect, useMemo, useState } from "react"
import { useGlobalClaudeConfig, useProjectClaudeConfig } from "../claude-config/useClaudeConfig"
import { mergeSkillOptions } from "../dispatch/skillOptions"
import { DEFAULT_SKILL, sameSkills, toggleSkill } from "../dispatch/spawnSkills"
import { useProjectPidSettings, useUpdateProjectPidSettings } from "./usePidSettings"

// The on-disk location of the settings this form edits, relative to the project
// root. Shown in the UI so it's clear what file is being managed.
export const PID_SETTINGS_REL_PATH = ".pid/settings.json"

export type PidSettingsForm = {
  readonly loading: boolean
  readonly error: boolean
  // All skill ids selectable as defaults (global + project skills + the stored default).
  readonly options: readonly string[]
  // The working selection (local edits, not yet saved).
  readonly selected: readonly string[]
  readonly toggle: (id: string) => void
  // True when the working selection differs from what is persisted.
  readonly dirty: boolean
  readonly saving: boolean
  readonly save: () => void
  readonly reset: () => void
}

// Owns the project-settings form state: loads the stored pid-settings, tracks a
// local working copy of `defaultSkills`, and exposes save/reset. Kept separate
// from the view so the rendering stays a pure function of props.
export const usePidSettingsForm = (projectId: string): PidSettingsForm => {
  const settings = useProjectPidSettings(projectId)
  const update = useUpdateProjectPidSettings(projectId)
  const globalConfig = useGlobalClaudeConfig()
  const projectConfig = useProjectClaudeConfig(projectId)

  const stored = settings.data?.defaultSkills
  const [selected, setSelected] = useState<readonly string[]>([])

  // Seed (and re-seed) the working copy whenever the persisted value changes —
  // on first load and after a successful save.
  useEffect(() => {
    if (stored) setSelected(stored)
  }, [stored])

  const options = useMemo(
    () =>
      mergeSkillOptions({
        defaultSkill: DEFAULT_SKILL,
        pinned: stored ?? [],
        globalSkills: globalConfig.data?.skills,
        projectSkills: projectConfig.data?.skills,
      }),
    [stored, globalConfig.data, projectConfig.data],
  )

  return {
    loading: settings.isLoading,
    error: settings.isError,
    options,
    selected,
    toggle: (id) => setSelected((prev) => toggleSkill(prev, id)),
    dirty: stored !== undefined && !sameSkills(selected, stored),
    saving: update.isPending,
    save: () => update.mutate({ defaultSkills: selected }),
    reset: () => stored && setSelected(stored),
  }
}
