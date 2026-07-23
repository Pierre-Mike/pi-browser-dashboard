import type { Project } from "../../lib/types"
import { CanvasTab } from "../canvas/CanvasTab"
import { ExcalidrawBoard } from "../excalidraw/ExcalidrawBoard"
import { ExcalidrawCompanion } from "../excalidraw/ExcalidrawCompanion"
import { BrainstormCompanion } from "./BrainstormCompanion"
import type { Brainstorm } from "./brainstorms"

type Props = {
  readonly project: Project
  readonly board: Brainstorm
}

/**
 * The split view for one selected brainstorm board: drawing editor left, AI
 * panel right. V1 canvas boards keep the role-driven companion crew; V2
 * Excalidraw boards pair the embedded Excalidraw editor with a single plain
 * session whose only context is the board's file.
 */
export const BrainstormBoardPanel = ({ project, board }: Props) => (
  <div className="flex flex-1 min-h-0 gap-2">
    <div className="flex-1 min-h-0" data-testid={`project-tab-panel-brainstorm-${board.id}`}>
      {board.kind === "excalidraw" ? (
        <ExcalidrawBoard projectId={project.id} slug={board.id} />
      ) : (
        <CanvasTab
          target={{ kind: "brainstorm", projectId: project.id, slug: board.id, file: board.file }}
        />
      )}
    </div>
    {board.kind === "excalidraw" ? (
      <ExcalidrawCompanion project={project} brainstorm={board} />
    ) : (
      <BrainstormCompanion project={project} brainstorm={board} />
    )}
  </div>
)
