import type { SessionState } from "../../lib/types"
import { TerminalView } from "../terminal/TerminalView"

type Props = { session: SessionState }

export const TerminalTab = ({ session }: Props) => (
  <TerminalView
    kind="session"
    id={session.short}
    reconnectTitle="Reconnect — respawns the underlying claude attach"
    testId="terminal-tab"
  />
)
