import { PanelResizeHandle } from "../../lib/PanelResizeHandle"
import { PANEL_DEFAULT_WIDTH, usePanelDrag, usePersistedWidth } from "../../lib/panelResize"
import type { SessionState } from "../../lib/types"
import { CanvasTab } from "../canvas/CanvasTab"
import { ExcalidrawBoard } from "../excalidraw/ExcalidrawBoard"
import { TerminalView } from "../terminal/TerminalView"
import { type Brainstorm, brainstormEditorFor } from "./brainstorms"

type Props = {
  readonly session: SessionState
  readonly board: Brainstorm
}

// A `.canvas` board is Obsidian JSON Canvas on disk, a legacy `.canvas.json`
// board the React-Flow encoding. Both open in the same editor; only the briefing
// the editor sends the agent has to tell them apart.
const formatOf = (board: Brainstorm) => (board.kind === "canvasJson" ? "reactFlow" : "jsonCanvas")

const Editor = ({ session, board }: Props) =>
  brainstormEditorFor(board.kind) === "excalidraw" ? (
    <ExcalidrawBoard short={session.short} path={board.path} label={board.label} />
  ) : (
    <CanvasTab
      target={{
        short: session.short,
        path: board.path,
        file: board.file,
        format: formatOf(board),
      }}
    />
  )

/**
 * This session's own terminal, docked beside the board. It replaces the old
 * spawn-a-companion panel outright: the session you are drilled into already
 * works in the worktree the board lives in, so telling *it* about the board is
 * both simpler and the only version that actually lands — a separately spawned
 * session would be writing into a different tree than the one on screen.
 */
const SessionAside = ({ session, board }: Props) => {
  // User-draggable width, persisted per-browser; the handle on the left edge
  // widens it as you drag left, double-click resets.
  const { width, setWidth } = usePersistedWidth("pid:brainstorm:companion-width")
  const { onResizeStart, dragging } = usePanelDrag(width, setWidth)

  return (
    <aside
      data-testid="brainstorm-companion"
      style={{ width }}
      // Shrinkable (not `shrink-0`): the board column's flex basis is 0, so a
      // too-wide panel gives width back here rather than pushing the row
      // off-screen behind a page-wide scrollbar.
      className={`relative flex min-w-0 flex-col gap-2 rounded-box border border-base-300 bg-base-200/40 p-2 min-h-0 ${
        dragging ? "select-none" : ""
      }`}
    >
      <PanelResizeHandle
        testid="brainstorm-companion-resize"
        ariaLabel="Resize session panel"
        onResizeStart={onResizeStart}
        onReset={() => setWidth(PANEL_DEFAULT_WIDTH)}
        onNudge={(delta) => setWidth(width + delta)}
      />
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-base-content/80">This session</span>
        <span
          data-testid="brainstorm-board-file"
          className="ml-auto truncate font-mono text-[10px] text-base-content/60"
          title={board.file}
        >
          {board.path}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <TerminalView
          kind="session"
          id={session.short}
          reconnectTitle="Reconnect to this session's terminal"
          testId="brainstorm-companion-terminal"
        />
      </div>
    </aside>
  )
}

/**
 * The split view for one selected board: drawing editor left, the session's own
 * terminal right. "Brief AI" in the editor toolbar hands the agent this board's
 * absolute path and format, after which every write it makes shows up live.
 */
export const SessionBoardPanel = ({ session, board }: Props) => (
  // `min-w-0` on both the row and the editor column is load-bearing: without it
  // the column's automatic minimum size is the editor's intrinsic content width
  // (Excalidraw's is ~1500px), so the editor grows past the row and shoves the
  // terminal off the right edge behind a page-wide horizontal scrollbar.
  <div className="flex flex-1 min-h-0 min-w-0 gap-2 overflow-hidden">
    <div className="flex-1 min-h-0 min-w-0" data-testid="session-board-editor">
      <Editor session={session} board={board} />
    </div>
    <SessionAside session={session} board={board} />
  </div>
)
