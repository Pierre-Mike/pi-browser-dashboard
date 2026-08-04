import type { SessionState } from "../../lib/types"
import { SessionBrainstormTab } from "../brainstorms/SessionBrainstormTab"
import { FileTree } from "../projects/FileTree"
import type { SessionPane } from "./sessionTabs"

const Pending = ({ label }: { readonly label: string }) => (
  <div className="px-1 py-4 flex items-center gap-2 text-sm text-base-content/50">
    <span className="loading loading-spinner loading-sm" />
    {label}
  </div>
)

/**
 * What fills the drill-in's right pane. The terminal is NOT here — it is the
 * split's permanent left column (see SessionSplit), so this renders only the
 * section the dock has selected and never has to fall back to the shell.
 *
 * Switches on the already-resolved `pane` rather than the raw `?tab=`, because
 * the raw value may be `brainstorm:<encoded path>` and comparing that to a
 * section name is the bug the resolution step exists to prevent.
 */
export const SessionPanel = ({
  pane,
  tab,
  id,
  session,
  onSelectTab,
}: {
  readonly pane: SessionPane
  // The raw `?tab=` value, still needed by Brainstorm to pick its board.
  readonly tab: string
  readonly id: string
  readonly session: SessionState | null | undefined
  readonly onSelectTab: (next: string) => void
}) => {
  if (pane === "files") {
    return (
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <FileTree resource={{ kind: "sessions", id }} />
      </div>
    )
  }
  // Brainstorm resolves boards against the session's worktree, so it needs the
  // loaded session rather than the id from the URL.
  if (!session) return <Pending label="Loading session…" />
  return <SessionBrainstormTab session={session} tab={tab} onSelectTab={onSelectTab} />
}
