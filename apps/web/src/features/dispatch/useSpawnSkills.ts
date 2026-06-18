import { useEffect, useMemo, useRef, useState } from "react"
import type { Project } from "../../lib/types"
import { useGlobalClaudeConfig, useProjectClaudeConfig } from "../claude-config/useClaudeConfig"
import { useProjectPidSettings, useUpdateProjectPidSettings } from "../pid-settings/usePidSettings"
import { mergeSkillOptions } from "./skillOptions"
import { DEFAULT_SKILL, resolveDefaultSkills, sameSkills, toggleSkill } from "./spawnSkills"

export type SpawnSkills = {
  // Currently-selected skill ids, in selection order.
  readonly selected: readonly string[]
  // All skill ids to render as toggle buttons.
  readonly options: readonly string[]
  readonly toggle: (id: string) => void
  // True when the selection equals the project's stored default (nothing to save).
  readonly isProjectDefault: boolean
  // Persist the current selection as this project's default. No-op without a project.
  readonly saveAsDefault: () => void
  readonly savePending: boolean
  // Whether default-management is available (a project is in scope).
  readonly canManageDefault: boolean
}

// Owns the spawn modal's skill selection: merges global + project skills into
// the picker, seeds the selection from the project's stored pid-settings default
// (which may load async), and exposes a save-as-default action. The branching
// logic lives in pure helpers (spawnSkills.ts); this is just the glue.
export const useSpawnSkills = (open: boolean, project: Project | null): SpawnSkills => {
  const [selected, setSelected] = useState<readonly string[]>([DEFAULT_SKILL])
  // True once the user has manually toggled this open; until then the selection
  // tracks the project's stored default (which may arrive after the modal opens).
  const touchedRef = useRef(false)
  const claudeConfig = useGlobalClaudeConfig()
  const projectConfig = useProjectClaudeConfig(project?.id ?? "")
  const pidSettings = useProjectPidSettings(project?.id ?? "")
  const update = useUpdateProjectPidSettings(project?.id ?? "")

  const projectDefaults = useMemo(
    () => resolveDefaultSkills(project !== null, pidSettings.data?.defaultSkills),
    [project, pidSettings.data],
  )

  const options = useMemo(
    () =>
      mergeSkillOptions({
        defaultSkill: DEFAULT_SKILL,
        pinned: projectDefaults,
        globalSkills: claudeConfig.data?.skills,
        projectSkills: project ? projectConfig.data?.skills : [],
      }),
    [claudeConfig.data, projectConfig.data, project, projectDefaults],
  )

  // Re-seed only on open; later default changes are handled by the sync effect
  // below, so projectDefaults is intentionally omitted from the deps here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional open-only reset
  useEffect(() => {
    if (open) {
      touchedRef.current = false
      setSelected(projectDefaults)
    }
  }, [open])

  // Re-seed when the project's stored default arrives after the modal is already
  // open, unless the user has started picking skills.
  useEffect(() => {
    if (open && !touchedRef.current) setSelected(projectDefaults)
  }, [open, projectDefaults])

  return {
    selected,
    options,
    toggle: (id) => {
      touchedRef.current = true
      setSelected((prev) => toggleSkill(prev, id))
    },
    isProjectDefault: sameSkills(selected, projectDefaults),
    saveAsDefault: () => update.mutate({ defaultSkills: selected }),
    savePending: update.isPending,
    canManageDefault: project !== null,
  }
}
