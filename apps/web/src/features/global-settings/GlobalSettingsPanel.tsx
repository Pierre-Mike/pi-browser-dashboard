import { GlobalSettingsView } from "./GlobalSettingsView"
import { useGlobalSettingsForm } from "./useGlobalSettingsForm"

// Global settings tab: manages <claudeConfigDir>/pid-dashboard/settings.json.
// Thin wrapper that wires the live form state into the presentational view.
export const GlobalSettingsPanel = () => <GlobalSettingsView form={useGlobalSettingsForm()} />
