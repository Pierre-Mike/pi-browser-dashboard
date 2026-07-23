import { useCallback, useEffect, useRef, useState } from "react"
import { wsBase } from "../../lib/apiBase"
import { canvasWsUrlFromPath } from "../canvas/canvasUrl"
import {
  docFromElements,
  docStableKey,
  type ExcalidrawDocument,
  emptyExcalidrawDocument,
  excalidrawWsPath,
  parseExcalidrawServerFrame,
} from "./excalidrawDoc"

const DEBOUNCE_MS = 200
const RECONNECT_MS = 1_500

export type ExcalidrawSyncStatus = "connecting" | "open" | "closed" | "error"

export type RemoteExcalidrawDoc = {
  readonly doc: ExcalidrawDocument
  // Bumps with every genuinely-remote document so the board re-applies even
  // when consecutive documents share content.
  readonly seq: number
}

export type ExcalidrawSyncApi = {
  readonly status: ExcalidrawSyncStatus
  // Latest genuinely-remote document (an agent's file write, another tab).
  readonly remote: RemoteExcalidrawDoc | null
  // Debounced publish of the local drawing; non-element keys of the last
  // known document are carried forward.
  readonly sendElements: (elements: readonly unknown[]) => void
}

// Live document sync for one Excalidraw board over the daemon's doc-room
// socket. Deliberately simpler than useCanvasSync: Excalidraw owns the scene
// state, so the hook only relays whole documents and dedupes by element key.
export const useExcalidrawSync = (ref: {
  readonly projectId: string
  readonly slug: string
}): ExcalidrawSyncApi => {
  const [status, setStatus] = useState<ExcalidrawSyncStatus>("connecting")
  const [remote, setRemote] = useState<RemoteExcalidrawDoc | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  // Latest known full document — the base whose non-element keys local edits
  // are grafted onto.
  const baseRef = useRef<ExcalidrawDocument>(emptyExcalidrawDocument())
  // Element key of the last document that crossed the wire in either
  // direction; sends and remote applies both dedupe against it.
  const lastWireKeyRef = useRef<string | null>(null)
  const pendingElementsRef = useRef<readonly unknown[] | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushUpstream = useCallback(() => {
    const ws = wsRef.current
    const pending = pendingElementsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || pending === null) return
    const doc = docFromElements(baseRef.current, pending)
    const key = docStableKey(doc)
    if (key === lastWireKeyRef.current) return
    lastWireKeyRef.current = key
    baseRef.current = doc
    try {
      ws.send(JSON.stringify({ kind: "snapshot", snapshot: doc }))
    } catch {
      // ws closed mid-send; the reconnect cycle will re-prime state.
    }
  }, [])

  const sendElements = useCallback(
    (elements: readonly unknown[]) => {
      pendingElementsRef.current = elements
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        flushUpstream()
      }, DEBOUNCE_MS)
    },
    [flushUpstream],
  )

  const applyServerDoc = useCallback((doc: ExcalidrawDocument, origin: string) => {
    baseRef.current = doc
    const key = docStableKey(doc)
    if (origin === "self" || key === lastWireKeyRef.current) {
      // Our own publish echoing back (or a reconnect re-prime of known state):
      // remember it, don't disturb the scene mid-draw.
      lastWireKeyRef.current = key
      return
    }
    lastWireKeyRef.current = key
    setRemote((prev) => ({ doc, seq: (prev?.seq ?? 0) + 1 }))
  }, [])

  // Key reconnection on the resolved ws path, not the ref's object identity —
  // callers may rebuild the ref object every render.
  const wsPath = excalidrawWsPath(ref)

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
      // Polite reconnect — the user might be mid-stroke when the daemon
      // restarts; without this they'd be stuck on a stale board.
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_MS)
    }
    ws.onmessage = (evt) => {
      if (typeof evt.data !== "string") return
      const frame = parseExcalidrawServerFrame(evt.data)
      if (frame === null) return
      if (frame.kind === "error") {
        console.error("[excalidraw] server frame error:", frame.message)
        return
      }
      applyServerDoc(frame.snapshot, frame.origin)
    }
  }, [wsPath, applyServerDoc])

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

  return { status, remote, sendElements }
}
