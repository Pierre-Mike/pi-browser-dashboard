import { TerminalView } from "../terminal/TerminalView"

// Dashboard-level terminal: attaches to the user's catch-all zellij session
// named "default" (their convention for the session that isn't tied to a
// specific repo). The daemon resolves cwd = $HOME on first spawn; subsequent
// reconnects just re-attach the running session.
export const GlobalTerminal = () => (
  <div className="flex flex-col flex-1 min-h-0 w-full">
    <TerminalView
      kind="global"
      reconnectTitle="Reconnect — re-attaches the 'default' zellij session"
      testId="global-terminal"
    />
  </div>
)
