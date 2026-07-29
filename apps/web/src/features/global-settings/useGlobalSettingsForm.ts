import type { GlobalSettings, SkillGroup } from "@pid/shared"
import { useEffect, useRef, useState } from "react"
import { formSectionsEqual, reseedDraft, type Section, setField, toFormPatch } from "./fields"
import { removeSkillGroup } from "./skillGroups"
import { useGlobalSettings, useUpdateGlobalSettings } from "./useGlobalSettings"

// The on-disk location this form edits, relative to the resolved Claude config
// dir. Shown in the UI so it's clear which file is being managed.
export const GLOBAL_SETTINGS_REL_PATH = "pid-dashboard/settings.json"

export type GlobalSettingsForm = {
  readonly loading: boolean
  readonly error: boolean
  // The working draft (local edits, not yet saved). Undefined until first load.
  readonly draft: GlobalSettings
  readonly setField: (args: { section: Section; key: string; raw: string }) => void
  // Skill-group presets (created from the spawn modal); the panel lists + removes.
  readonly skillGroups: readonly SkillGroup[]
  readonly removeSkillGroup: (name: string) => void
  readonly dirty: boolean
  readonly saving: boolean
  readonly save: () => void
  readonly reset: () => void
}

// Owns the global-settings form state: loads the stored settings, tracks a local
// working draft, exposes setField/save/reset. Kept separate from the view so the
// rendering stays a pure function of props.
export const useGlobalSettingsForm = (): GlobalSettingsForm => {
  const settings = useGlobalSettings()
  const update = useUpdateGlobalSettings()
  const stored = settings.data
  const [draft, setDraft] = useState<GlobalSettings | undefined>(undefined)
  const seeded = useRef<GlobalSettings | undefined>(undefined)

  // Seed (and re-seed) the working copy whenever the persisted value changes —
  // on first load, after a successful save, and now also when the Appearance
  // section writes the `ui` section. `reseedDraft` is what keeps that third case
  // from discarding edits in progress; the ref holds the value we last seeded
  // from, read *before* it is overwritten.
  useEffect(() => {
    if (stored === undefined) return
    const previous = seeded.current
    seeded.current = stored
    setDraft((prev) => reseedDraft({ draft: prev, seeded: previous, stored }))
  }, [stored])

  const effective = draft ?? stored
  // Only the sections this form renders a control for count: a `ui` change
  // arriving from the Appearance section is not an unsaved edit of anything here.
  const dirty = stored !== undefined && draft !== undefined && !formSectionsEqual(draft, stored)

  return {
    loading: settings.isLoading || effective === undefined,
    error: settings.isError,
    // The view only reads `draft` when not loading, so the fallback is safe.
    draft: effective as GlobalSettings,
    setField: ({ section, key, raw }) =>
      setDraft((prev) => (prev ? setField({ settings: prev, section, key, raw }) : prev)),
    skillGroups: effective?.skillGroups ?? [],
    removeSkillGroup: (name) =>
      setDraft((prev) =>
        prev ? { ...prev, skillGroups: removeSkillGroup(prev.skillGroups, name) } : prev,
      ),
    dirty,
    saving: update.isPending,
    save: () => draft && update.mutate(toFormPatch(draft)),
    reset: () => stored && setDraft(stored),
  }
}
