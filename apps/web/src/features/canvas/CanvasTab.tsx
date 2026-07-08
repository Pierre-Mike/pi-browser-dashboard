import { useQueryClient } from "@tanstack/react-query"
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
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
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../../lib/api"
import type { SessionState } from "../../lib/types"
import { snapshotFromReactFlow } from "./canvas.types"
import { type Axis, alignNodes, distributeNodes, findFirstMatch } from "./canvasArrange"
import { CANVAS_IMPORT_EVENT, type CanvasImportDetail } from "./canvasEmbed"
import {
  type GroupableNode,
  groupSelected as groupSelectedNodes,
  ungroupNode,
} from "./canvasGrouping"
import { isPaneClassName, newBoxAt } from "./canvasInteractions"
import {
  type ArrowDirection,
  colorFor,
  duplicateSelection,
  fromJsonCanvas,
  newHistory,
  normalizeArrow,
  OBSIDIAN_COLORS,
  type ObsidianColor,
  parseJsonCanvas,
  pushHistory,
  redo as redoHistory,
  serializeJsonCanvas,
  toJsonCanvas,
  undo as undoHistory,
} from "./canvasObsidian"
import { EditableBoxNode } from "./EditableBoxNode"
import { EditableFileNode } from "./EditableFileNode"
import { EditableGroupNode } from "./EditableGroupNode"
import { EditableLinkNode } from "./EditableLinkNode"
import { type SyncStatus, useCanvasSync } from "./useCanvasSync"

// The document this canvas edits: a per-session scratch canvas (with a
// "Brief AI" button that messages the session), or a named project brainstorm
// document (whose AI companions are driven by the Brainstorm tab instead).
type CanvasDocTarget =
  | { readonly kind: "session"; readonly session: SessionState }
  | {
      readonly kind: "brainstorm"
      readonly projectId: string
      readonly slug: string
      readonly file: string
    }

type Props = { readonly target: CanvasDocTarget }

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
    cls: "bg-base-200 text-base-content/80",
  },
  open: {
    label: "live",
    cls: "bg-success/15 text-success",
  },
  closed: {
    label: "reconnecting",
    cls: "bg-warning/15 text-warning",
  },
  error: {
    label: "error",
    cls: "bg-error/15 text-error",
  },
}

const nodeTypes = {
  box: EditableBoxNode,
  group: EditableGroupNode,
  link: EditableLinkNode,
  file: EditableFileNode,
}

const GRID_STEP = 16

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

const decoratedEdge = (e: Edge): Edge => {
  const data = (e.data ?? {}) as Record<string, unknown>
  const arrow: ArrowDirection = normalizeArrow(data.arrow)
  const color = typeof data.color === "string" ? data.color : ""
  const palette = colorFor(color)
  const stroke = palette.stroke || undefined
  return {
    ...e,
    markerEnd:
      arrow === "none"
        ? undefined
        : {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            ...(stroke ? { color: stroke } : {}),
          },
    markerStart:
      arrow === "both"
        ? {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            ...(stroke ? { color: stroke } : {}),
          }
        : undefined,
    style: stroke ? { ...(e.style ?? {}), stroke } : e.style,
    labelStyle: stroke ? { fill: stroke } : undefined,
  }
}

const CanvasInner = ({ target }: Props) => {
  const qc = useQueryClient()
  const short = target.kind === "session" ? target.session.short : null
  const docRef = useMemo(
    () =>
      target.kind === "session"
        ? ({ kind: "session", short: target.session.short } as const)
        : ({ kind: "brainstorm", projectId: target.projectId, slug: target.slug } as const),
    [target],
  )
  const { nodes, edges, status, setNodes, setEdges, resetCanvas, lastUpdatedAt } =
    useCanvasSync(docRef)
  const [briefing, setBriefing] = useState(false)
  const [briefStatus, setBriefStatus] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [edgeLabelDraft, setEdgeLabelDraft] = useState("")
  const [readOnly, setReadOnly] = useState(false)
  const [snap, setSnap] = useState(false)
  const [search, setSearch] = useState("")
  const rf = useReactFlow()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // --- Undo/redo history ------------------------------------------------------
  // We snapshot {nodes, edges} after a settled change. `applyingRef` suppresses
  // pushes during an undo/redo apply so we don't re-record the restored frame.
  const historyRef = useRef(newHistory<Node, Edge>())
  const applyingRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, setHistoryRev] = useState(0)
  const bumpHistory = useCallback(() => setHistoryRev((r) => r + 1), [])

  useEffect(() => {
    if (applyingRef.current) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      historyRef.current = pushHistory(historyRef.current, { nodes, edges })
      bumpHistory()
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [nodes, edges, bumpHistory])

  const onUndo = useCallback(() => {
    const result = undoHistory(historyRef.current, { nodes, edges })
    if (!result) return
    applyingRef.current = true
    historyRef.current = result.history
    setNodes(result.frame.nodes as Node[])
    setEdges(result.frame.edges as Edge[])
    // Release the lock on the next tick so the effect-driven push above
    // doesn't immediately re-record the restored frame.
    setTimeout(() => {
      applyingRef.current = false
    }, 0)
    bumpHistory()
  }, [nodes, edges, setNodes, setEdges, bumpHistory])

  const onRedo = useCallback(() => {
    const result = redoHistory(historyRef.current, { nodes, edges })
    if (!result) return
    applyingRef.current = true
    historyRef.current = result.history
    setNodes(result.frame.nodes as Node[])
    setEdges(result.frame.edges as Edge[])
    setTimeout(() => {
      applyingRef.current = false
    }, 0)
    bumpHistory()
  }, [nodes, edges, setNodes, setEdges, bumpHistory])

  // Default new boxes to our editable type so users get inline editing right
  // away. Existing nodes from disk without a `type` also render as the
  // editable box because we default "box" below.
  const renderableNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => {
        const locked = (n.data as Record<string, unknown> | undefined)?.locked === true
        const draggable = !readOnly && !locked
        const base =
          n.type === "group" || n.type === "link" || n.type === "file"
            ? n
            : !n.type
              ? { ...n, type: "box" }
              : n
        return { ...base, draggable, connectable: !readOnly } as Node
      }),
    [nodes, readOnly],
  )

  const renderableEdges = useMemo<Edge[]>(() => edges.map(decoratedEdge), [edges])

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
            data: { arrow: "forward" },
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

  // --- Add primitives --------------------------------------------------------

  const addBox = useCallback(() => {
    const id = `n-${Date.now().toString(36)}`
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: "box",
        position: { x: 80 + (prev.length % 5) * 180, y: 80 + Math.floor(prev.length / 5) * 90 },
        data: { label: "New box" },
        // Explicit size so NodeResizer has dimensions to drag from. Without
        // this, the node auto-sizes to text content and the resize handles
        // jump as content changes.
        style: { width: 160, height: 60 },
      } as Node,
    ])
  }, [setNodes])

  const addFile = useCallback(() => {
    const id = `f-${Date.now().toString(36)}`
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: "file",
        position: { x: 80 + (prev.length % 5) * 220, y: 320 + Math.floor(prev.length / 5) * 110 },
        data: { file: "" },
        style: { width: 220, height: 80 },
      } as Node,
    ])
  }, [setNodes])

  const addLink = useCallback(() => {
    const id = `l-${Date.now().toString(36)}`
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: "link",
        position: { x: 80 + (prev.length % 5) * 220, y: 200 + Math.floor(prev.length / 5) * 110 },
        data: { url: "" },
        style: { width: 220, height: 80 },
      } as Node,
    ])
  }, [setNodes])

  // Obsidian parity: double-clicking empty canvas drops a fresh box centered
  // under the cursor and opens it for editing. We guard on the pane class so a
  // double-click on a node/handle/edge still goes to that element instead.
  const onPaneDoubleClick = useCallback(
    (ev: React.MouseEvent) => {
      if (readOnly) return
      if (!isPaneClassName((ev.target as HTMLElement).className)) return
      const point = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      const box = newBoxAt(point, `n-${Date.now().toString(36)}`)
      setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), box as unknown as Node])
    },
    [readOnly, rf, setNodes],
  )

  // --- Grouping (existing) ---------------------------------------------------

  const groupSelection = useCallback(() => {
    setNodes((prev) => {
      const selectedIds = prev.filter((n) => n.selected).map((n) => n.id)
      if (selectedIds.length < 2) return prev
      const { nodes: next } = groupSelectedNodes({
        nodes: prev.map(toGroupable),
        selectedIds,
        opts: { label: "Group" },
      })
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

  // --- Color application -----------------------------------------------------

  const setSelectionColor = useCallback(
    (color: ObsidianColor) => {
      // Apply to selected nodes...
      setNodes((prev) =>
        prev.map((n) => {
          if (!n.selected) return n
          const data = { ...(n.data as Record<string, unknown>), color }
          return { ...n, data }
        }),
      )
      // ...and to selected edges (if any). Edge selection lives in our
      // local `selectedEdgeId` because React Flow doesn't expose a "selected"
      // flag on Edge in v12 the same way it does on Node.
      setEdges((prev) =>
        prev.map((e) =>
          e.selected || e.id === selectedEdgeId
            ? { ...e, data: { ...((e.data ?? {}) as Record<string, unknown>), color } }
            : e,
        ),
      )
    },
    [setNodes, setEdges, selectedEdgeId],
  )

  const setEdgeArrow = useCallback(
    (arrow: ArrowDirection) => {
      if (!selectedEdgeId) return
      setEdges((prev) =>
        prev.map((e) =>
          e.id === selectedEdgeId
            ? { ...e, data: { ...((e.data ?? {}) as Record<string, unknown>), arrow } }
            : e,
        ),
      )
    },
    [setEdges, selectedEdgeId],
  )

  // --- Duplicate -------------------------------------------------------------

  const onDuplicate = useCallback(() => {
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id)
    if (selectedIds.length === 0) return
    let counter = 0
    const newId = () => {
      counter += 1
      return `d-${Date.now().toString(36)}-${counter}`
    }
    const cloned = duplicateSelection({
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        type: n.type,
        data: n.data as Record<string, unknown> | undefined,
        width: n.width ?? null,
        height: n.height ?? null,
        parentId: n.parentId ?? null,
        extent: n.extent,
        style: (n.style ?? null) as Record<string, unknown> | null,
        selected: n.selected,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        label: typeof e.label === "string" ? e.label : undefined,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        data: (e.data ?? {}) as Record<string, unknown>,
      })),
      selectedIds,
      newId,
    })
    setNodes((prev) => [
      ...prev.map((n) => ({ ...n, selected: false })),
      ...(cloned.nodes as unknown as Node[]),
    ])
    setEdges((prev) => [...prev, ...(cloned.edges as unknown as Edge[])])
  }, [nodes, edges, setNodes, setEdges])

  // --- Align / distribute / lock --------------------------------------------

  const onAlign = useCallback(
    (axis: Axis) => {
      setNodes((prev) => {
        const selectedIds = prev.filter((n) => n.selected).map((n) => n.id)
        if (selectedIds.length < 2) return prev
        const arrangeable = prev.map((n) => ({
          id: n.id,
          position: n.position,
          width: typeof n.width === "number" ? n.width : (n.measured?.width ?? null),
          height: typeof n.height === "number" ? n.height : (n.measured?.height ?? null),
          selected: n.selected,
          data: n.data as Record<string, unknown> | undefined,
        }))
        const aligned = alignNodes({ nodes: arrangeable, selectedIds, axis })
        return prev.map((n, i) => {
          const next = aligned[i]
          return next ? ({ ...n, position: next.position } as Node) : n
        })
      })
    },
    [setNodes],
  )

  const onDistribute = useCallback(
    (axis: "horizontal" | "vertical") => {
      setNodes((prev) => {
        const selectedIds = prev.filter((n) => n.selected).map((n) => n.id)
        if (selectedIds.length < 3) return prev
        const arrangeable = prev.map((n) => ({
          id: n.id,
          position: n.position,
          width: typeof n.width === "number" ? n.width : (n.measured?.width ?? null),
          height: typeof n.height === "number" ? n.height : (n.measured?.height ?? null),
          selected: n.selected,
        }))
        const distributed = distributeNodes({ nodes: arrangeable, selectedIds, axis })
        return prev.map((n, i) => {
          const next = distributed[i]
          return next ? ({ ...n, position: next.position } as Node) : n
        })
      })
    },
    [setNodes],
  )

  const onToggleLock = useCallback(() => {
    setNodes((prev) => {
      const someUnlocked = prev.some(
        (n) => n.selected && (n.data as Record<string, unknown> | undefined)?.locked !== true,
      )
      return prev.map((n) => {
        if (!n.selected) return n
        const data = { ...(n.data as Record<string, unknown>), locked: someUnlocked }
        return { ...n, data }
      })
    })
  }, [setNodes])

  const onSelectAll = useCallback(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, selected: true })))
  }, [setNodes])

  // --- Search ----------------------------------------------------------------

  const runSearch = useCallback(
    (query: string) => {
      const id = findFirstMatch(
        nodes.map((n) => ({
          id: n.id,
          position: n.position,
          width: typeof n.width === "number" ? n.width : null,
          height: typeof n.height === "number" ? n.height : null,
          data: n.data as Record<string, unknown> | undefined,
        })),
        query,
      )
      if (!id) return
      rf.fitView({ padding: 0.4, nodes: [{ id }], duration: 300 })
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })))
    },
    [nodes, rf, setNodes],
  )

  // --- Fit to selection / content -------------------------------------------

  const onFit = useCallback(() => {
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id)
    if (selectedIds.length > 0) {
      rf.fitView({ padding: 0.2, nodes: selectedIds.map((id) => ({ id })) })
    } else {
      rf.fitView({ padding: 0.2 })
    }
  }, [rf, nodes])

  // --- Keyboard shortcuts ----------------------------------------------------

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) return
      const mod = ev.metaKey || ev.ctrlKey
      if (!mod) return
      if (ev.key.toLowerCase() === "z" && !ev.shiftKey) {
        ev.preventDefault()
        onUndo()
      } else if ((ev.key.toLowerCase() === "z" && ev.shiftKey) || ev.key.toLowerCase() === "y") {
        ev.preventDefault()
        onRedo()
      } else if (ev.key.toLowerCase() === "d") {
        ev.preventDefault()
        onDuplicate()
      } else if (ev.key.toLowerCase() === "a") {
        ev.preventDefault()
        onSelectAll()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onUndo, onRedo, onDuplicate, onSelectAll])

  // --- Export / import .canvas ----------------------------------------------

  const onExport = useCallback(() => {
    const snap = snapshotFromReactFlow({
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        type: n.type,
        data: n.data as Record<string, unknown> | undefined,
        width: n.width ?? n.measured?.width ?? null,
        height: n.height ?? n.measured?.height ?? null,
        parentId: n.parentId ?? null,
        extent: n.extent,
        style: (n.style ?? null) as Record<string, unknown> | null,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        label: typeof e.label === "string" ? e.label : undefined,
        animated: e.animated,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        data: (e.data ?? undefined) as Record<string, unknown> | undefined,
      })),
    })
    const jc = toJsonCanvas(snap)
    const blob = new Blob([serializeJsonCanvas(jc)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = target.kind === "session" ? `session-${short}.canvas` : `${target.slug}.canvas`
    a.click()
    URL.revokeObjectURL(url)
  }, [nodes, edges, short, target])

  const onImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const importCanvasText = useCallback(
    (text: string) => {
      try {
        const jc = parseJsonCanvas(text)
        const snap = fromJsonCanvas(jc)
        const newNodes = snap.nodes.map(
          (n) =>
            ({
              id: n.id,
              type: n.type ?? "box",
              position: { x: n.position.x, y: n.position.y },
              data: (n.data ?? {}) as Record<string, unknown>,
              style: (n.style ?? {}) as Record<string, unknown>,
            }) as Node,
        )
        const newEdges = snap.edges.map(
          (e) =>
            ({
              id: e.id,
              source: e.source,
              target: e.target,
              label: e.label,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
              data: (e.data ?? {}) as Record<string, unknown>,
            }) as Edge,
        )
        setNodes(newNodes)
        setEdges(newEdges)
      } catch (err) {
        console.error("[canvas] import failed", err)
      }
    },
    [setNodes, setEdges],
  )

  const onImportFile = useCallback(
    async (ev: ChangeEvent<HTMLInputElement>) => {
      const file = ev.target.files?.[0]
      if (!file) return
      const text = await file.text()
      ev.target.value = ""
      importCanvasText(text)
    },
    [importCanvasText],
  )

  // Drag-and-drop a .canvas file onto the canvas surface.
  const onDrop = useCallback(
    async (ev: React.DragEvent<HTMLDivElement>) => {
      const file = ev.dataTransfer.files?.[0]
      if (!file) return
      if (!file.name.endsWith(".canvas") && file.type !== "application/json") return
      ev.preventDefault()
      const text = await file.text()
      importCanvasText(text)
    },
    [importCanvasText],
  )

  const onDragOver = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    if (ev.dataTransfer.types.includes("Files")) ev.preventDefault()
  }, [])

  // Bridge for cross-canvas: file nodes referencing a .canvas dispatch a
  // CustomEvent with the fetched text, and we import it onto this canvas.
  useEffect(() => {
    const onEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<CanvasImportDetail>).detail
      if (detail && typeof detail.text === "string") importCanvasText(detail.text)
    }
    window.addEventListener(CANVAS_IMPORT_EVENT, onEvent)
    return () => window.removeEventListener(CANVAS_IMPORT_EVENT, onEvent)
  }, [importCanvasText])

  const selectedCount = useMemo(() => nodes.filter((n) => n.selected).length, [nodes])
  const aGroupIsSelected = useMemo(
    () => nodes.some((n) => n.selected && n.type === "group"),
    [nodes],
  )
  const canUndo = historyRef.current.past.length >= 2
  const canRedo = historyRef.current.future.length > 0
  const canColor = selectedCount > 0 || selectedEdgeId !== null

  const selectedEdgeArrow: ArrowDirection = useMemo(() => {
    if (!selectedEdgeId) return "forward"
    const e = edges.find((x) => x.id === selectedEdgeId)
    return normalizeArrow((e?.data as Record<string, unknown> | undefined)?.arrow)
  }, [edges, selectedEdgeId])

  const canvasPath = useMemo(
    () => (target.kind === "session" ? `~/.claude/jobs/${short}/canvas.json` : target.file),
    [short, target],
  )

  const onBriefAi = useCallback(async () => {
    if (short === null) return
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
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200"
        >
          + Box
        </button>
        <button
          type="button"
          data-testid="canvas-add-link"
          onClick={addLink}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200"
          title="Add a link node"
        >
          + Link
        </button>
        <button
          type="button"
          data-testid="canvas-add-file"
          onClick={addFile}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200"
          title="Add a file reference node"
        >
          + File
        </button>
        <button
          type="button"
          data-testid="canvas-group"
          onClick={groupSelection}
          disabled={selectedCount < 2 || aGroupIsSelected}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200 disabled:opacity-40"
          title="Wrap the selected boxes under one group (select 2+ first)"
        >
          Group ({selectedCount})
        </button>
        <button
          type="button"
          data-testid="canvas-ungroup"
          onClick={ungroupSelection}
          disabled={!aGroupIsSelected}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200 disabled:opacity-40"
          title="Remove the selected group (its children stay)"
        >
          Ungroup
        </button>
        <span className="flex items-center gap-1" data-testid="canvas-color-picker">
          {OBSIDIAN_COLORS.map((c) => (
            <button
              key={c.key || "none"}
              type="button"
              data-testid={`canvas-color-${c.key || "none"}`}
              onClick={() => setSelectionColor(c.key)}
              disabled={!canColor}
              title={`Color: ${c.label}`}
              className="w-4 h-4 rounded-full border border-base-300 disabled:opacity-30"
              style={{
                backgroundColor: c.fill === "transparent" ? "transparent" : c.fill,
                borderColor: c.stroke,
              }}
            />
          ))}
        </span>
        <button
          type="button"
          data-testid="canvas-duplicate"
          onClick={onDuplicate}
          disabled={selectedCount === 0}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200 disabled:opacity-40"
          title="Duplicate selection (Cmd/Ctrl+D)"
        >
          Duplicate
        </button>
        <button
          type="button"
          data-testid="canvas-undo"
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200 disabled:opacity-40"
          title="Undo (Cmd/Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="canvas-redo"
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200 disabled:opacity-40"
          title="Redo (Cmd/Ctrl+Shift+Z)"
        >
          Redo
        </button>
        <button
          type="button"
          data-testid="canvas-fit"
          onClick={onFit}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200"
          title="Fit to selection / content"
        >
          Fit
        </button>
        <button
          type="button"
          data-testid="canvas-readonly"
          onClick={() => setReadOnly((v) => !v)}
          className={`rounded border border-base-300 px-2 py-0.5 ${
            readOnly ? "bg-warning/15 text-warning" : "hover:bg-base-200"
          }`}
          title="Toggle read-only mode (no dragging or connecting)"
        >
          {readOnly ? "Read-only ✓" : "Read-only"}
        </button>
        <button
          type="button"
          data-testid="canvas-snap"
          onClick={() => setSnap((v) => !v)}
          className={`rounded border border-base-300 px-2 py-0.5 ${
            snap ? "bg-primary/15 text-primary" : "hover:bg-base-200"
          }`}
          title="Snap to grid while dragging"
        >
          {snap ? "Snap ✓" : "Snap"}
        </button>
        <button
          type="button"
          data-testid="canvas-lock"
          onClick={onToggleLock}
          disabled={selectedCount === 0}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200 disabled:opacity-40"
          title="Pin / unpin selected nodes"
        >
          Lock
        </button>
        <span className="inline-flex border border-base-300 rounded overflow-hidden">
          {(
            [
              { key: "left", label: "L" },
              { key: "centerX", label: "CX" },
              { key: "right", label: "R" },
              { key: "top", label: "T" },
              { key: "centerY", label: "CY" },
              { key: "bottom", label: "B" },
            ] as ReadonlyArray<{ key: Axis; label: string }>
          ).map((a) => (
            <button
              key={a.key}
              type="button"
              data-testid={`canvas-align-${a.key}`}
              onClick={() => onAlign(a.key)}
              disabled={selectedCount < 2}
              className="px-1.5 py-0.5 hover:bg-base-200 disabled:opacity-40 border-r border-base-300 last:border-r-0"
              title={`Align ${a.key}`}
            >
              {a.label}
            </button>
          ))}
        </span>
        <span className="inline-flex border border-base-300 rounded overflow-hidden">
          <button
            type="button"
            data-testid="canvas-distribute-h"
            onClick={() => onDistribute("horizontal")}
            disabled={selectedCount < 3}
            className="px-1.5 py-0.5 hover:bg-base-200 disabled:opacity-40 border-r border-base-300"
            title="Distribute horizontally"
          >
            ↔
          </button>
          <button
            type="button"
            data-testid="canvas-distribute-v"
            onClick={() => onDistribute("vertical")}
            disabled={selectedCount < 3}
            className="px-1.5 py-0.5 hover:bg-base-200 disabled:opacity-40"
            title="Distribute vertically"
          >
            ↕
          </button>
        </span>
        <input
          data-testid="canvas-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              runSearch(search)
            }
            e.stopPropagation()
          }}
          placeholder="search…"
          className="border border-base-300 rounded px-1.5 py-0.5 bg-base-100 w-32"
        />
        {selectedEdgeId ? (
          <span className="flex items-center gap-1" data-testid="canvas-edge-toolbar">
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
              className="border border-base-300 rounded px-1.5 py-0.5 bg-base-100 w-32"
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
              className="rounded border border-base-300 px-1.5 py-0.5 hover:bg-base-200"
              title="Clear arrow label"
            >
              clear
            </button>
            <span className="inline-flex border border-base-300 rounded overflow-hidden">
              {(["none", "forward", "both"] as ArrowDirection[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  data-testid={`canvas-arrow-${a}`}
                  onClick={() => setEdgeArrow(a)}
                  className={`px-1.5 py-0.5 ${
                    selectedEdgeArrow === a ? "bg-primary/15 text-primary" : "hover:bg-base-200"
                  }`}
                  title={`Arrow: ${a}`}
                >
                  {a === "none" ? "—" : a === "forward" ? "→" : "↔"}
                </button>
              ))}
            </span>
          </span>
        ) : null}
        <button
          type="button"
          data-testid="canvas-export"
          onClick={onExport}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200"
          title="Export as Obsidian .canvas"
        >
          Export
        </button>
        <button
          type="button"
          data-testid="canvas-import"
          onClick={onImportClick}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200"
          title="Import a .canvas file"
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".canvas,application/json"
          onChange={onImportFile}
          className="hidden"
          data-testid="canvas-import-input"
        />
        {target.kind === "session" ? (
          <button
            type="button"
            data-testid="canvas-brief-ai"
            onClick={() => void onBriefAi()}
            disabled={briefing}
            className="rounded border border-primary/40 bg-primary/10 text-primary px-2 py-0.5 hover:bg-primary/20 disabled:opacity-40"
            title="Send the AI a message telling it where to find this canvas so it can read/write live"
          >
            {briefing ? "Briefing…" : "Brief AI"}
          </button>
        ) : null}
        <button
          type="button"
          data-testid="canvas-reset"
          onClick={resetCanvas}
          className="rounded border border-base-300 px-2 py-0.5 hover:bg-base-200"
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
          <span className="text-[10px] text-base-content/60" title={`Last sync: ${lastUpdatedAt}`}>
            synced
          </span>
        ) : null}
        {briefStatus ? (
          <span
            data-testid="canvas-brief-status"
            className="text-[10px] text-base-content/80 ml-auto"
          >
            {briefStatus}
          </span>
        ) : null}
        <span className="text-[10px] text-base-content/60 ml-auto">
          dbl-click empty space to add a box · dbl-click box/arrow to edit · Del to remove · drag
          handles to connect
        </span>
      </div>
      <div
        className="flex-1 min-h-0 rounded-lg border border-base-300 bg-base-100"
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <ReactFlow
          nodes={renderableNodes}
          edges={renderableEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => setSelectedEdgeId(null)}
          onDoubleClick={onPaneDoubleClick}
          onEdgeDoubleClick={(_, edge) => {
            setSelectedEdgeId(edge.id)
            setEdgeLabelDraft(typeof edge.label === "string" ? edge.label : "")
          }}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          snapToGrid={snap}
          snapGrid={[GRID_STEP, GRID_STEP]}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesFocusable={!readOnly}
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
