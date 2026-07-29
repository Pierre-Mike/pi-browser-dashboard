import { useTheme } from "../../lib/ui/useTheme"
import { GlobalSettingsView } from "./GlobalSettingsView"
import { useGlobalSettingsForm } from "./useGlobalSettingsForm"

// Global settings tab: manages <claudeConfigDir>/pid-dashboard/settings.json.
// Thin wrapper that wires the live form state in. The theme comes from a
// separate per-browser store (localStorage), not from that file — see useTheme.
export const GlobalSettingsPanel = () => (
  <GlobalSettingsView form={useGlobalSettingsForm()} theme={useTheme()} />
)
