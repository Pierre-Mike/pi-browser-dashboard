import type { Edge, Node } from "@xyflow/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { wsBase } from "../../lib/apiBase"
import { type CanvasSnapshot, emptyCanvas } from "./canvas.types"
import {
  canvasShouldSend,
  canvasStableKey,
  reactFlowToSnapshot,
  snapshotToReactFlow,
} from "./canvasSync"
import { type CanvasDocRef, canvasWsPath, canvasWsUrlFromPath } from "./canvasUrl"

const DEBOUNCE_MS = 200
const RECONNECT_MS = 1_500

export type SyncStatus = "connecting" | "open" | "closed" | "error"

type ServerFrame =
  | {
      readonly kind: "snapshot"
      readonly snapshot: CanvasSnapshot
      readonly origin: "self" | "remote"
    }
  | { readonly kind: "error"; readonly message: string }

export type CanvasSyncApi = {
  readonly nodes: Node[]
  readonly edges: Edge[]
  readonly status: SyncStatus
  readonly setNodes: (next: Node[] | ((prev: Node[]) => Node[])) => void
  readonly setEdges: (next: Edge[] | ((prev: Edge[]) => Edge[])) => void
  readonly resetCanvas: () => void
  readonly lastUpdatedAt: string | null
}

export const useCanvasSync = (docRef: CanvasDocRef): CanvasSyncApi => {
  const [nodes, setNodesState] = useState<Node[]>([])
  const [edges, setEdgesState] = useState<Edge[]>([])
  const [status, setStatus] = useState<SyncStatus>("connecting")
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const lastWireRef = useRef<CanvasSnapshot | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodesRef = useRef<Node[]>(nodes)
  const edgesRef = useRef<Edge[]>(edges)

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  const flushUpstream = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const snap = reactFlowToSnapshot({ nodes: nodesRef.current, edges: edgesRef.current })
    if (!canvasShouldSend(snap, lastWireRef.current)) return
    lastWireRef.current = snap
    try {
      ws.send(JSON.stringify({ kind: "snapshot", snapshot: snap }))
    } catch {
      // ws closed mid-send; the reconnect cycle will re-prime state.
    }
  }, [])

  const scheduleFlush = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      flushUpstream()
    }, DEBOUNCE_MS)
  }, [flushUpstream])

  const applySnapshotFromServer = useCallback((snap: CanvasSnapshot) => {
    // Compare against last-known wire state by stable key — if the server is
    // echoing something we already sent (e.g. on reconnect re-prime), skip the
    // setNodes/setEdges to avoid an unnecessary React Flow re-layout.
    if (lastWireRef.current && canvasStableKey(snap) === canvasStableKey(lastWireRef.current)) {
      lastWireRef.current = snap
      setLastUpdatedAt(snap.updatedAt)
      return
    }
    lastWireRef.current = snap
    const { nodes: nextNodes, edges: nextEdges } = snapshotToReactFlow(snap)
    setNodesState(nextNodes)
    setEdgesState(nextEdges)
    setLastUpdatedAt(snap.updatedAt)
  }, [])

  // Key reconnection on the resolved ws path, not the ref's object identity —
  // callers may rebuild the ref object every render.
  const wsPath = canvasWsPath(docRef)

  const connect = useCallback(() => {
    const url = canvasWsUrlFromPath({ baseUrl: wsBase(), path: wsPath })
    setStatus("connecting")
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onopen = () => setStatus("open")
    ws.onerror = () => setStatus("error")
    ws.onclose = () => {
      setStatus("closed")
      wsRef.current = null
      // Polite reconnect — the user might be mid-drag when the daemon
      // restarts; without this they'd be stuck on a stale canvas.
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_MS)
    }
    ws.onmessage = (evt) => {
      if (typeof evt.data !== "string") return
      let frame: ServerFrame
      try {
        frame = JSON.parse(evt.data) as ServerFrame
      } catch {
        return
      }
      if (frame.kind === "snapshot") {
        applySnapshotFromServer(frame.snapshot)
      } else if (frame.kind === "error") {
        console.error("[canvas] server frame error:", frame.message)
      }
    }
  }, [wsPath, applySnapshotFromServer])

  useEffect(() => {
    connect()
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      const ws = wsRef.current
      wsRef.current = null
      if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    }
    // Reconnect only when the document changes — `connect` carries its own
    // identity via the wsPath closure.
  }, [connect])

  const setNodes = useCallback<CanvasSyncApi["setNodes"]>(
    (next) => {
      setNodesState((prev) => {
        const value = typeof next === "function" ? (next as (p: Node[]) => Node[])(prev) : next
        return value
      })
      scheduleFlush()
    },
    [scheduleFlush],
  )

  const setEdges = useCallback<CanvasSyncApi["setEdges"]>(
    (next) => {
      setEdgesState((prev) => {
        const value = typeof next === "function" ? (next as (p: Edge[]) => Edge[])(prev) : next
        return value
      })
      scheduleFlush()
    },
    [scheduleFlush],
  )

  const resetCanvas = useCallback(() => {
    const blank = emptyCanvas()
    lastWireRef.current = blank
    setNodesState([])
    setEdgesState([])
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ kind: "snapshot", snapshot: blank }))
      } catch {
        // ws closed
      }
    }
  }, [])

  return { nodes, edges, status, setNodes, setEdges, resetCanvas, lastUpdatedAt }
}
