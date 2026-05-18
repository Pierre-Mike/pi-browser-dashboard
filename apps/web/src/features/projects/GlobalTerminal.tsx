import { TerminalView } from "../terminal/TerminalView"

// Dashboard-level terminal: attaches to the user's catch-all zellij session
// named "default" (their convention for the session that isn't tied to a
// specific repo). The daemon resolves cwd = $HOME on first spawn; subsequent
// reconnects just re-attach the running session.
export const GlobalTerminal = () => (
  <div className="flex flex-col gap-2 min-h-[24rem] h-[calc(100vh-18rem)]">
    <div className="flex items-baseline gap-2">
      <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Terminal
      </h2>
      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
        zellij · default
      </span>
    </div>
    <TerminalView
      kind="global"
      reconnectTitle="Reconnect — re-attaches the 'default' zellij session"
      testId="global-terminal"
    />
  </div>
)
