import { TerminalView } from "../terminal/TerminalView"

// Orchestration tab: a window into the single, machine-wide voice supervisor.
//
// The daemon pins this to one zellij session named "Orchestrator" — the same
// name voice-event.sh types every worker's Stop/Notification event into. So the
// supervisor you watch here is the one the whole fleet reports back to, no
// matter which project page you opened it from. It is deliberately NOT scoped to
// the project: a second supervisor would split the hook stream.
//
// First open boots the session from the Orchestrator repo (TTS daemon + claude
// loaded with the repo's orchestrator CLAUDE.md); later opens re-attach the live
// session, so the conversation and worker context survive browser refreshes.
export const OrchestrationPanel = () => (
  <div className="flex flex-col flex-1 min-h-0 w-full gap-1">
    <p className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
      The orchestrator supervises every worker session by voice and dispatches new ones on your
      behalf. Worker completions and questions stream into this session automatically.
    </p>
    <TerminalView
      kind="orchestrator"
      reconnectTitle="Reconnect — re-attaches the Orchestrator session (it keeps running)"
      testId="orchestration-terminal"
    />
  </div>
)
