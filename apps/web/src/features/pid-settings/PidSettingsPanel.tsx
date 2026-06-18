import { PidSettingsView } from "./PidSettingsView"
import { usePidSettingsForm } from "./usePidSettingsForm"

type Props = {
  projectId: string
}

// Per-project settings tab: manages <project>/.pid/settings.json. Thin wrapper
// that wires the live form state into the presentational view.
export const PidSettingsPanel = ({ projectId }: Props) => (
  <PidSettingsView form={usePidSettingsForm(projectId)} />
)
