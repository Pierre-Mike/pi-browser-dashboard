import { TerminalView } from "../terminal/TerminalView"

type Props = { projectId: string }

// Project-level terminal: the daemon hands us a long-lived bare zellij session
// named after the repo. The user picks what to run inside it (claude, tests,
// scratch shells). Browser tabs come and go; the zellij daemon keeps the
// session warm so a refresh re-attaches to the same panes.
export const ProjectTerminal = ({ projectId }: Props) => (
  <div className="flex flex-col flex-1 min-h-0 w-full">
    <TerminalView
      kind="project"
      id={projectId}
      reconnectTitle="Reconnect — re-attaches the zellij session (panes stay running)"
      testId="project-terminal"
    />
  </div>
)
