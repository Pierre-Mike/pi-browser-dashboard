import { useEffect } from "react"
import { applyMachineTheme } from "../../lib/ui/useTheme"
import { useGlobalSettings } from "./useGlobalSettings"

/**
 * Feeds the machine-wide theme default from the global-settings `ui` section into
 * the theme store, once the settings query answers.
 *
 * Called once, from `routes/__root.tsx`, because the default has to reach the
 * whole shell rather than only the Settings tab — the point of the feature is a
 * second device that has never opened Settings. The query key is shared with the
 * panel, so this costs one request per stale window, not one per reader.
 *
 * A failure needs no branch: `data` stays undefined, the store's machine offer
 * clears, and every reader falls back through `resolveThemeChoice` exactly as it
 * did before a default existed. That is what keeps the Appearance picker working
 * with the daemon down.
 */
export const useMachineTheme = (): void => {
  const { data } = useGlobalSettings()
  useEffect(() => {
    applyMachineTheme({ ui: data?.ui })
  }, [data])
}
