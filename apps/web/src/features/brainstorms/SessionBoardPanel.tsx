import type { SessionState } from "../../lib/types"
import { CanvasTab } from "../canvas/CanvasTab"
import { ExcalidrawBoard } from "../excalidraw/ExcalidrawBoard"
import { BriefAgentButton } from "./BriefAgentButton"
import { type Brainstorm, brainstormEditorFor, briefFormatFor } from "./brainstorms"

type Props = {
  readonly session: SessionState
  readonly board: Brainstorm
}

const Editor = ({ session, board }: Props) =>
  brainstormEditorFor(board.kind) === "excalidraw" ? (
    <ExcalidrawBoard short={session.short} path={board.path} label={board.label} />
  ) : (
    <CanvasTab target={{ short: session.short, path: board.path, file: board.file }} />
  )

/**
 * One selected board, filling the pane it was given.
 *
 * It used to be a split — board left, a second attach to *this session's own
 * terminal* right — because the board needed some way to talk to the agent. The
 * drill-in now docks that terminal permanently to the left of this whole pane, so
 * the inner one was the same pty rendered twice, competing for the same width.
 * What survives it is the one thing it was really for: a button that hands the
 * agent this board's path and format.
 */
export const SessionBoardPanel = ({ session, board }: Props) => (
  <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-1 overflow-hidden">
    <div className="flex shrink-0 items-center gap-2">
      <BriefAgentButton
        short={session.short}
        file={board.file}
        format={briefFormatFor(board.kind)}
      />
      <span
        data-testid="brainstorm-board-file"
        className="ml-auto truncate font-mono text-[10px] text-base-content/60"
        title={board.file}
      >
        {board.path}
      </span>
    </div>
    {/* `min-w-0` is load-bearing: without it the column's automatic minimum size
        is the editor's intrinsic content width (Excalidraw's is ~1500px), so the
        editor grows past the pane and shoves the terminal off the left edge
        behind a page-wide horizontal scrollbar. */}
    <div className="flex-1 min-h-0 min-w-0" data-testid="session-board-editor">
      <Editor session={session} board={board} />
    </div>
  </div>
)
