import { useEffect, useState } from "react"
import { type Section, setField, settingsEqual } from "./fields"
import type { GlobalSettings } from "./types"
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

  // Seed (and re-seed) the working copy whenever the persisted value changes —
  // on first load and after a successful save.
  useEffect(() => {
    if (stored) setDraft(stored)
  }, [stored])

  const effective = draft ?? stored
  const dirty = stored !== undefined && draft !== undefined && !settingsEqual(draft, stored)

  return {
    loading: settings.isLoading || effective === undefined,
    error: settings.isError,
    // The view only reads `draft` when not loading, so the fallback is safe.
    draft: effective as GlobalSettings,
    setField: ({ section, key, raw }) =>
      setDraft((prev) => (prev ? setField({ settings: prev, section, key, raw }) : prev)),
    dirty,
    saving: update.isPending,
    save: () => draft && update.mutate(draft),
    reset: () => stored && setDraft(stored),
  }
}
