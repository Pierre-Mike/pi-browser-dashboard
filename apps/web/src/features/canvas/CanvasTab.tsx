import { useQueryClient } from "@tanstack/react-query"
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useCallback, useMemo, useState } from "react"
import { api } from "../../lib/api"
import type { SessionState } from "../../lib/types"
import { EditableBoxNode } from "./EditableBoxNode"
import { EditableGroupNode } from "./EditableGroupNode"
import {
  type GroupableNode,
  groupSelected as groupSelectedNodes,
  ungroupNode,
} from "./canvasGrouping"
import { type SyncStatus, useCanvasSync } from "./useCanvasSync"

type Props = { readonly session: SessionState }

const briefingMessage = (canvasPath: string): string =>
  [
    "You have a shared canvas at:",
    `  ${canvasPath}`,
    "",
    "It is a JSON file with React-Flow shape:",
    "  { version: 1, nodes: [{ id, position:{x,y}, type?, data:{label?},",
    "                          parentId?, extent?: 'parent', style?:{width,height} }],",
    "    edges: [{ id, source, target, label? }] }",
    "",
    "Nodes with type 'group' act as containers; child nodes set parentId and",
    "extent:'parent' and use coordinates relative to the group's position.",
    "Edge labels render as text on the arrow.",
    "",
    "Use your Read tool to see what I drew, and your Write tool to update it.",
    "The browser side syncs live — when you Write, my canvas updates in real time.",
    "Help me improve the diagram: rename boxes, add arrows with labels,",
    "group related boxes, propose new nodes. Talk about your changes in chat.",
  ].join("\n")

const statusBadge: Record<SyncStatus, { label: string; cls: string }> = {
  connecting: {
    label: "connecting",
    cls: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
  },
  open: {
    label: "live",
    cls: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200",
  },
  closed: {
    label: "reconnecting",
    cls: "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200",
  },
  error: {
    label: "error",
    cls: "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200",
  },
}

const nodeTypes = {
  box: EditableBoxNode,
  group: EditableGroupNode,
}

const toGroupable = (n: Node): GroupableNode => ({
  id: n.id,
  position: n.position,
  type: n.type,
  parentId: n.parentId,
  extent: n.extent === "parent" ? "parent" : undefined,
  width: typeof n.width === "number" ? n.width : null,
  height: typeof n.height === "number" ? n.height : null,
  measuredWidth: n.measured?.width ?? null,
  measuredHeight: n.measured?.height ?? null,
  data: n.data as Record<string, unknown> | undefined,
  style: n.style as Record<string, unknown> | undefined,
})

const CanvasInner = ({ session }: Props) => {
  const qc = useQueryClient()
  const short = session.short
  const { nodes, edges, status, setNodes, setEdges, resetCanvas, lastUpdatedAt } =
    useCanvasSync(short)
  const [briefing, setBriefing] = useState(false)
  const [briefStatus, setBriefStatus] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [edgeLabelDraft, setEdgeLabelDraft] = useState("")

  // Default new boxes to our editable type so users get inline editing right
  // away. Existing nodes from disk without a `type` also render as the
  // editable box because we default "box" below.
  const renderableNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => {
        if (n.type === "group") return n
        if (!n.type) return { ...n, type: "box" }
        return n
      }),
    [nodes],
  )

  const renderableEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        ...e,
        markerEnd: e.markerEnd ?? { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      })),
    [edges],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((prev) => applyNodeChanges(changes, prev))
    },
    [setNodes],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => applyEdgeChanges(changes, prev))
      for (const c of changes) {
        if (c.type === "select" && !c.selected && c.id === selectedEdgeId) {
          setSelectedEdgeId(null)
        }
        if (c.type === "remove" && c.id === selectedEdgeId) {
          setSelectedEdgeId(null)
        }
      }
    },
    [setEdges, selectedEdgeId],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((prev) =>
        addEdge(
          {
            ...conn,
            id: `e-${conn.source}-${conn.target}-${Date.now()}`,
            markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          },
          prev,
        ),
      )
    },
    [setEdges],
  )

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedEdgeId(edge.id)
    setEdgeLabelDraft(typeof edge.label === "string" ? edge.label : "")
  }, [])

  const commitEdgeLabel = useCallback(() => {
    if (!selectedEdgeId) return
    const next = edgeLabelDraft
    setEdges((prev) =>
      prev.map((e) => (e.id === selectedEdgeId ? { ...e, label: next || undefined } : e)),
    )
  }, [selectedEdgeId, edgeLabelDraft, setEdges])

  const addBox = useCallback(() => {
    const id = `n-${Date.now().toString(36)}`
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: "box",
        position: { x: 80 + (prev.length % 5) * 180, y: 80 + Math.floor(prev.length / 5) * 90 },
        data: { label: "New box" },
      } as Node,
    ])
  }, [setNodes])

  const groupSelection = useCallback(() => {
    setNodes((prev) => {
      const selectedIds = prev.filter((n) => n.selected).map((n) => n.id)
      if (selectedIds.length < 2) return prev
      const { nodes: next } = groupSelectedNodes(prev.map(toGroupable), selectedIds, {
        label: "Group",
      })
      // Reattach React Flow runtime fields the pure helper doesn't track
      // (selected flag, callbacks, etc.). GroupableNode is a subset of Node so
      // widening is safe.
      return next.map((n) => {
        const original = prev.find((p) => p.id === n.id)
        if (original) return { ...original, ...n, selected: false } as Node
        return { ...n, selected: true } as unknown as Node
      })
    })
  }, [setNodes])

  const ungroupSelection = useCallback(() => {
    setNodes((prev) => {
      const targetGroup = prev.find((n) => n.selected && n.type === "group")
      if (!targetGroup) return prev
      const next = ungroupNode(prev.map(toGroupable), targetGroup.id)
      return next.map((n) => {
        const original = prev.find((p) => p.id === n.id)
        if (original) {
          const merged = { ...original, ...n } as Node
          if (n.parentId === undefined) {
            const { parentId: _p, extent: _e, ...rest } = merged
            return rest as Node
          }
          return merged
        }
        return n as unknown as Node
      })
    })
  }, [setNodes])

  const selectedCount = useMemo(() => nodes.filter((n) => n.selected).length, [nodes])
  const aGroupIsSelected = useMemo(
    () => nodes.some((n) => n.selected && n.type === "group"),
    [nodes],
  )

  const canvasPath = useMemo(() => `~/.claude/jobs/${short}/canvas.json`, [short])

  const onBriefAi = useCallback(async () => {
    if (briefing) return
    setBriefing(true)
    setBriefStatus("briefing AI…")
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const keys = `${briefingMessage(canvasPath)}\r`
      const res = await client.sessions[":id"].send.$post({
        param: { id: short },
        json: { keys },
      })
      if (!res.ok) {
        setBriefStatus(`failed: HTTP ${res.status}`)
        return
      }
      qc.invalidateQueries({ queryKey: ["transcript", short] })
      setBriefStatus("AI briefed — check the chat tab")
    } catch (err) {
      setBriefStatus(`failed: ${err instanceof Error ? err.message : "unknown"}`)
    } finally {
      setBriefing(false)
      setTimeout(() => setBriefStatus(null), 4_000)
    }
  }, [briefing, canvasPath, qc, short])

  const badge = statusBadge[status]

  return (
    <div data-testid="canvas-tab" className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 px-1 pt-2 pb-1 text-xs">
        <button
          type="button"
          data-testid="canvas-add-box"
          onClick={addBox}
          className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          + Box
        </button>
        <button
          type="button"
          data-testid="canvas-group"
          onClick={groupSelection}
          disabled={selectedCount < 2 || aGroupIsSelected}
          className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          title="Wrap the selected boxes under one group (select 2+ first)"
        >
          Group ({selectedCount})
        </button>
        <button
          type="button"
          data-testid="canvas-ungroup"
          onClick={ungroupSelection}
          disabled={!aGroupIsSelected}
          className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          title="Remove the selected group (its children stay)"
        >
          Ungroup
        </button>
        {selectedEdgeId ? (
          <span className="flex items-center gap-1">
            <input
              data-testid="canvas-edge-label-input"
              value={edgeLabelDraft}
              onChange={(e) => setEdgeLabelDraft(e.target.value)}
              onBlur={commitEdgeLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  commitEdgeLabel()
                }
                e.stopPropagation()
              }}
              placeholder="arrow label"
              className="border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 w-32"
            />
            <button
              type="button"
              data-testid="canvas-edge-label-clear"
              onClick={() => {
                setEdgeLabelDraft("")
                setEdges((prev) =>
                  prev.map((e) => (e.id === selectedEdgeId ? { ...e, label: undefined } : e)),
                )
              }}
              className="rounded border border-slate-300 dark:border-slate-700 px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Clear arrow label"
            >
              clear
            </button>
          </span>
        ) : null}
        <button
          type="button"
          data-testid="canvas-brief-ai"
          onClick={() => void onBriefAi()}
          disabled={briefing}
          className="rounded border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 px-2 py-0.5 hover:bg-sky-100 dark:hover:bg-sky-900/50 disabled:opacity-40"
          title="Send the AI a message telling it where to find this canvas so it can read/write live"
        >
          {briefing ? "Briefing…" : "Brief AI"}
        </button>
        <button
          type="button"
          data-testid="canvas-reset"
          onClick={resetCanvas}
          className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Clear all nodes and edges"
        >
          Clear
        </button>
        <span
          data-testid="canvas-status"
          className={`px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold ${badge.cls}`}
        >
          {badge.label}
        </span>
        {lastUpdatedAt ? (
          <span
            className="text-[10px] text-slate-500 dark:text-slate-400"
            title={`Last sync: ${lastUpdatedAt}`}
          >
            synced
          </span>
        ) : null}
        {briefStatus ? (
          <span
            data-testid="canvas-brief-status"
            className="text-[10px] text-slate-600 dark:text-slate-300 ml-auto"
          >
            {briefStatus}
          </span>
        ) : null}
        <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">
          dbl-click box/arrow to edit · Del to remove · drag handles to connect
        </span>
      </div>
      <div className="flex-1 min-h-0 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
        <ReactFlow
          nodes={renderableNodes}
          edges={renderableEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => setSelectedEdgeId(null)}
          onEdgeDoubleClick={(_, edge) => {
            setSelectedEdgeId(edge.id)
            setEdgeLabelDraft(typeof edge.label === "string" ? edge.label : "")
          }}
          deleteKeyCode={["Backspace", "Delete"]}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  )
}

export const CanvasTab = (props: Props) => (
  <ReactFlowProvider>
    <CanvasInner {...props} />
  </ReactFlowProvider>
)
