import { usePersistedFlag } from "../../lib/collapse"
import { BRAINSTORM_ICON, subTabButtonClass } from "../../lib/tabDock"
import type { SessionState } from "../../lib/types"
import { CollapsibleRail, RailExpandButton } from "../projects/CollapsibleRail"
import { BOARD_RAIL } from "../projects/railExpand"
import { type Brainstorm, boardTabKey, selectedBoard } from "./brainstorms"
import { NewBrainstormButton } from "./NewBrainstormButton"
import { SessionBoardPanel } from "./SessionBoardPanel"
import { useBrainstorms } from "./useBrainstorms"

type Props = {
  readonly session: SessionState
  readonly tab: string
  readonly onSelectTab: (next: string) => void
}

const EmptyState = () => (
  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-base-300 bg-base-200/40 p-8 text-center text-sm text-base-content/60">
    No boards in this worktree — click <span className="font-medium text-base-content/80">+</span>{" "}
    for a drawing board, or drop a <span className="font-mono text-base-content/80">.canvas</span>{" "}
    file anywhere in the tree.
  </div>
)

const BoardRail = ({
  boards,
  selected,
  short,
  collapsed,
  onToggle,
  onSelect,
}: {
  readonly boards: readonly Brainstorm[]
  readonly selected: Brainstorm | null
  readonly short: string
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly onSelect: (path: string) => void
}) => (
  <CollapsibleRail
    collapsed={collapsed}
    onToggle={onToggle}
    ariaLabel={BOARD_RAIL.ariaLabel}
    testid={BOARD_RAIL.testid}
  >
    {boards.map((b) => (
      <button
        key={b.path}
        type="button"
        role="tab"
        aria-selected={selected?.path === b.path}
        data-testid={`brainstorm-subtab-${b.label}`}
        data-active={selected?.path === b.path}
        onClick={() => onSelect(b.path)}
        title={b.path}
        className={subTabButtonClass(selected?.path === b.path)}
      >
        <span className="shrink-0">{BRAINSTORM_ICON}</span>
        <span className="truncate">{b.label}</span>
      </button>
    ))}
    <NewBrainstormButton short={short} onCreated={onSelect} />
    <NewBrainstormButton short={short} kind="excalidraw" onCreated={onSelect} />
  </CollapsibleRail>
)

/**
 * The session drill-in's Brainstorm section: a left rail of every drawing found
 * in this session's worktree beside the editor for the selected one.
 *
 * Session-scoped rather than project-scoped on purpose. The boards live in the
 * tree the session already works in, so the agent's writes land in the file the
 * browser has open — a project-scoped board asked a session to write outside its
 * own worktree, which is the edit that used to go missing.
 */
export const SessionBrainstormTab = ({ session, tab, onSelectTab }: Props) => {
  const boardsQ = useBrainstorms(session.short)
  const rail = usePersistedFlag("pid:brainstorm:rail-collapsed")
  const boards = boardsQ.data ?? []
  const selected = selectedBoard({ boards, tab })
  const onSelect = (path: string) => onSelectTab(boardTabKey(path))

  return (
    <div
      role="tabpanel"
      data-testid="session-tab-panel-brainstorm"
      className="flex flex-1 min-h-0 min-w-0 gap-2"
    >
      <BoardRail
        boards={boards}
        selected={selected}
        short={session.short}
        collapsed={rail.value}
        onToggle={rail.toggle}
        onSelect={onSelect}
      />
      {/* A collapsed rail leaves nothing behind, so the chip that brings it
          back has to live inside the panel. */}
      {rail.value ? (
        <div className="shrink-0 pt-1">
          <RailExpandButton rail={BOARD_RAIL} onToggle={rail.toggle} />
        </div>
      ) : null}

      {selected === null ? (
        <EmptyState />
      ) : (
        // Keyed by path so document sync fully resets when switching boards.
        <SessionBoardPanel key={selected.path} session={session} board={selected} />
      )}
    </div>
  )
}
