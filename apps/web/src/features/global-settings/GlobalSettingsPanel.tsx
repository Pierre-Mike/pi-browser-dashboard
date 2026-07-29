import { useTheme } from "../../lib/ui/useTheme"
import { GlobalSettingsView } from "./GlobalSettingsView"
import { useUpdateGlobalSettings } from "./useGlobalSettings"
import { useGlobalSettingsForm } from "./useGlobalSettingsForm"

// Global settings tab: manages <claudeConfigDir>/pid-dashboard/settings.json.
// Thin wrapper that wires the live form state in.
//
// Appearance has two halves and they persist to different places: the choice this
// browser shows lives in localStorage (useTheme, immediate), and the machine-wide
// default lives in the `ui` section of the file behind an explicit action. Its
// mutation is separate from the form's Save so a theme write cannot be blocked by
// an unrelated invalid field — and vice versa.
export const GlobalSettingsPanel = () => {
  const form = useGlobalSettingsForm()
  const theme = useTheme()
  const update = useUpdateGlobalSettings()
  return (
    <GlobalSettingsView
      form={form}
      theme={theme}
      saveDefault={{
        saving: update.isPending,
        failed: update.isError,
        run: () =>
          update.mutate({
            ui: { themeFamily: theme.choice.family, themeMode: theme.choice.mode },
          }),
      }}
    />
  )
}
