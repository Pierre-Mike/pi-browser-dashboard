import { PanelResizeHandle } from "../../lib/PanelResizeHandle"
import { PANEL_DEFAULT_WIDTH, usePanelDrag, usePersistedWidth } from "../../lib/panelResize"
import type { SessionState } from "../../lib/types"
import { SessionPanel } from "./SessionPanel"
import { sessionPaneFor } from "./sessionTabs"
import { TerminalTab } from "./TerminalTab"

type Props = {
  readonly id: string
  // The raw `?tab=` value: a board arrives as `brainstorm:<encoded path>`.
  readonly tab: string
  readonly session: SessionState | null | undefined
  readonly onSelectTab: (next: string) => void
}

const PendingTerminal = () => (
  <div className="px-1 py-4 flex items-center gap-2 text-sm text-base-content/50">
    <span className="loading loading-spinner loading-sm" />
    Loading session…
  </div>
)

/**
 * The session drill-in's body: **the terminal, always**, with one optional
 * section docked to its right on a draggable splitter.
 *
 * The terminal is rendered unconditionally and in a fixed position in this tree,
 * which is the whole design. Every section used to be a tab that *replaced* it,
 * so opening the file tree unmounted xterm, dropped the websocket attach, and
 * cost a reconnect plus the visible scrollback on the way back. Now nothing a
 * user can click takes the shell off screen — the pane opens beside it or not at
 * all.
 *
 * `?tab=` still carries the selection, so a deep link to a section (or to one
 * brainstorm board) survives, and the pane's width is a per-browser preference
 * rather than part of the URL.
 */
export const SessionSplit = ({ id, tab, session, onSelectTab }: Props) => {
  const pane = sessionPaneFor(tab)
  // Read unconditionally: the pane is conditional, so hooks inside it would
  // change React's hook count the first time a section opens.
  const { width, setWidth } = usePersistedWidth("pid:session:pane-width")
  const { onResizeStart, dragging } = usePanelDrag(width, setWidth)

  return (
    <div className="flex flex-1 min-h-0 min-w-0 gap-2 overflow-hidden">
      <div data-testid="session-terminal-pane" className="flex-1 min-h-0 min-w-0">
        {session ? <TerminalTab session={session} /> : <PendingTerminal />}
      </div>

      {pane === null ? null : (
        // Shrinkable (not `shrink-0`): the terminal column's flex basis is 0, so
        // a pane dragged wider than the row gives width back here rather than
        // pushing the row off-screen behind a page-wide horizontal scrollbar.
        <aside
          data-testid="session-side-pane"
          aria-label="Session side panel"
          style={{ width }}
          className={`relative flex min-w-0 min-h-0 flex-col rounded-box border border-base-300 bg-base-200/40 p-2 ${
            dragging ? "select-none" : ""
          }`}
        >
          <PanelResizeHandle
            testid="session-side-pane-resize"
            ariaLabel="Resize side panel"
            onResizeStart={onResizeStart}
            onReset={() => setWidth(PANEL_DEFAULT_WIDTH)}
            onNudge={(delta) => setWidth(width + delta)}
          />
          <SessionPanel pane={pane} tab={tab} id={id} session={session} onSelectTab={onSelectTab} />
        </aside>
      )}
    </div>
  )
}
