import { useQueryClient } from "@tanstack/react-query"
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
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
import { type SyncStatus, useCanvasSync } from "./useCanvasSync"

type Props = { readonly session: SessionState }

const briefingMessage = (canvasPath: string): string =>
  [
    "You have a shared canvas at:",
    `  ${canvasPath}`,
    "",
    "It is a JSON file with React-Flow shape:",
    "  { version: 1, nodes: [{ id, position:{x,y}, data:{label?} }],",
    "    edges: [{ id, source, target, label? }] }",
    "",
    "Use your Read tool to see what I drew, and your Write tool to update it.",
    "The browser side syncs live — when you Write, my canvas updates in real time.",
    "Help me improve the diagram: rename boxes, add arrows, propose new nodes,",
    "reorganize layout. Talk about your changes in chat so I can follow along.",
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

const CanvasInner = ({ session }: Props) => {
  const qc = useQueryClient()
  const short = session.short
  const { nodes, edges, status, setNodes, setEdges, resetCanvas, lastUpdatedAt } =
    useCanvasSync(short)
  const [briefing, setBriefing] = useState(false)
  const [briefStatus, setBriefStatus] = useState<string | null>(null)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((prev) => applyNodeChanges(changes, prev))
    },
    [setNodes],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => applyEdgeChanges(changes, prev))
    },
    [setEdges],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((prev) =>
        addEdge({ ...conn, id: `e-${conn.source}-${conn.target}-${Date.now()}` }, prev),
      )
    },
    [setEdges],
  )

  const addBox = useCallback(() => {
    const id = `n-${Date.now().toString(36)}`
    setNodes((prev) => [
      ...prev,
      {
        id,
        position: { x: 80 + (prev.length % 5) * 180, y: 80 + Math.floor(prev.length / 5) * 90 },
        data: { label: "New box" },
      } as Node,
    ])
  }, [setNodes])

  const canvasPath = useMemo(() => {
    // Best-effort guess for the user-facing path. The daemon ultimately owns
    // resolution — this is a hint we show in the briefing message.
    return `~/.claude/jobs/${short}/canvas.json`
  }, [short])

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
      </div>
      <div className="flex-1 min-h-0 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
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
