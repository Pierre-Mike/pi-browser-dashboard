import { TerminalView } from "../terminal/TerminalView"

type Props = { projectId: string; projectName: string }

// Project-level terminal: the daemon hands us a long-lived zellij session named
// after the repo, running `claude` inside. Browser tabs come and go; the zellij
// daemon keeps the session warm so a refresh re-attaches to the same REPL.
export const ProjectTerminal = ({ projectId, projectName }: Props) => (
  <div className="flex flex-col gap-2 min-h-[24rem] h-[calc(100vh-24rem)]">
    <div className="flex items-baseline gap-2">
      <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Terminal
      </h2>
      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
        zellij · {projectName}
      </span>
    </div>
    <TerminalView
      kind="project"
      id={projectId}
      reconnectTitle="Reconnect — re-attaches the zellij session (claude stays running)"
      testId="project-terminal"
    />
  </div>
)
