// Read-only JSON Canvas (.canvas) preview, reusable from any project file
// tree. Reuses the live canvas editor's node renderers so an Obsidian-style
// .canvas file looks the same here as in the dedicated CanvasTab — but with
// dragging, connecting, and keyboard deletion disabled.

import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useMemo } from "react"
import { EditableBoxNode } from "../canvas/EditableBoxNode"
import { EditableFileNode } from "../canvas/EditableFileNode"
import { EditableGroupNode } from "../canvas/EditableGroupNode"
import { EditableLinkNode } from "../canvas/EditableLinkNode"
import { parseCanvasFile, snapshotToReactFlowEdges, snapshotToReactFlowNodes } from "./canvasParse"

type Props = { readonly raw: string }

const nodeTypes = {
  box: EditableBoxNode,
  group: EditableGroupNode,
  link: EditableLinkNode,
  file: EditableFileNode,
}

const Inner = ({ raw }: Props) => {
  const parsed = useMemo(() => parseCanvasFile(raw), [raw])
  const nodes = useMemo(
    () => (parsed.ok ? snapshotToReactFlowNodes(parsed.snapshot) : []),
    [parsed],
  )
  const edges = useMemo(
    () => (parsed.ok ? snapshotToReactFlowEdges(parsed.snapshot) : []),
    [parsed],
  )

  if (!parsed.ok) {
    return (
      <div
        data-testid="file-body-canvas-error"
        className="flex flex-col items-center justify-center h-full px-6 text-center gap-2 text-base-content/60"
      >
        <div className="text-4xl">🗺️</div>
        <div className="text-sm font-medium text-error">Could not parse .canvas file</div>
        <div className="text-xs font-mono text-base-content/60 max-w-md break-words">
          {parsed.error}
        </div>
      </div>
    )
  }

  if (nodes.length === 0 && edges.length === 0) {
    return (
      <div
        data-testid="file-body-canvas-empty"
        className="flex flex-col items-center justify-center h-full text-base-content/60 gap-2"
      >
        <div className="text-4xl">🗺️</div>
        <div className="text-sm">Empty canvas — no nodes or edges to render.</div>
      </div>
    )
  }

  return (
    <div data-testid="file-body-canvas" className="w-full h-full bg-base-100">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable={false}
        deleteKeyCode={null}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}

export const CanvasView = (props: Props) => (
  <ReactFlowProvider>
    <Inner {...props} />
  </ReactFlowProvider>
)
