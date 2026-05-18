import type { Context } from "hono"
import { Hono } from "hono"
import { resolveConfigDir } from "../../platform/config-dir"
import { upgradeWebSocket } from "../../platform/ws"
import { type CanvasSnapshot, parseCanvas, serializeCanvas } from "./canvas.core"
import { getCanvasRoom } from "./canvas.repo"

const MAX_FRAME_BYTES = 256 * 1024

type ClientFrame =
  | { readonly kind: "snapshot"; readonly snapshot: CanvasSnapshot }
  | { readonly kind: "request" }

type ServerFrame =
  | {
      readonly kind: "snapshot"
      readonly snapshot: CanvasSnapshot
      readonly origin: "self" | "remote"
    }
  | { readonly kind: "error"; readonly message: string }

const parseClientFrame = (raw: unknown): ClientFrame | { error: string } => {
  if (typeof raw !== "string") return { error: "frame must be a JSON string" }
  if (raw.length > MAX_FRAME_BYTES) return { error: "frame exceeds 256KB cap" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: "frame is not valid JSON" }
  }
  if (typeof parsed !== "object" || parsed === null) return { error: "frame must be an object" }
  const obj = parsed as Record<string, unknown>
  if (obj.kind === "request") return { kind: "request" }
  if (obj.kind === "snapshot") {
    try {
      return { kind: "snapshot", snapshot: parseCanvas(obj.snapshot) }
    } catch (err) {
      return { error: `bad snapshot: ${(err as Error).message}` }
    }
  }
  return { error: `unknown kind: ${String(obj.kind)}` }
}

const sendServerFrame = (ws: { send: (data: string) => void }, frame: ServerFrame): void => {
  try {
    ws.send(JSON.stringify(frame))
  } catch {
    // ws closed mid-broadcast
  }
}

// Each upgraded socket binds to one room. We track the origin symbol so the
// room.publish() loop can tell "the sender" apart from "other tabs".
type SocketCtx = {
  readonly origin: symbol
  unsubscribe: () => void
}

const ctxMap = new WeakMap<object, SocketCtx>()

const makeCanvasWsHandler = () =>
  upgradeWebSocket((c: Context) => {
    const short = c.req.param("id") ?? ""
    const tokenKey = {}
    return {
      onOpen: async (_evt, ws) => {
        if (!short) {
          sendServerFrame(ws, { kind: "error", message: "missing session id" })
          ws.close(1008, "missing_id")
          return
        }
        let room: Awaited<ReturnType<typeof getCanvasRoom>>
        try {
          room = await getCanvasRoom(resolveConfigDir(), short)
        } catch (err) {
          sendServerFrame(ws, { kind: "error", message: (err as Error).message })
          ws.close(1011, "room_init_failed")
          return
        }
        const origin = Symbol(`canvas-ws-${short}`)
        const unsubscribe = room.subscribe((snap, fromSelf) => {
          sendServerFrame(ws, {
            kind: "snapshot",
            snapshot: snap,
            origin: fromSelf ? "self" : "remote",
          })
        })
        ctxMap.set(tokenKey, { origin, unsubscribe })
        // Prime the client with whatever is on disk right now (or the empty
        // canvas if the session has never been drawn on).
        sendServerFrame(ws, { kind: "snapshot", snapshot: room.snapshot(), origin: "remote" })
      },
      onMessage: async (evt, ws) => {
        const ctx = ctxMap.get(tokenKey)
        if (!ctx) return
        const frame = parseClientFrame(evt.data)
        if ("error" in frame) {
          sendServerFrame(ws, { kind: "error", message: frame.error })
          return
        }
        let room: Awaited<ReturnType<typeof getCanvasRoom>>
        try {
          room = await getCanvasRoom(resolveConfigDir(), short)
        } catch (err) {
          sendServerFrame(ws, { kind: "error", message: (err as Error).message })
          return
        }
        if (frame.kind === "request") {
          sendServerFrame(ws, {
            kind: "snapshot",
            snapshot: room.snapshot(),
            origin: "remote",
          })
          return
        }
        try {
          await room.publish(frame.snapshot, ctx.origin)
        } catch (err) {
          sendServerFrame(ws, { kind: "error", message: (err as Error).message })
        }
      },
      onClose: () => {
        const ctx = ctxMap.get(tokenKey)
        if (!ctx) return
        ctxMap.delete(tokenKey)
        ctx.unsubscribe()
      },
    }
  })

const app = new Hono()
  .get("/:id", async (c) => {
    const short = c.req.param("id")
    const room = await getCanvasRoom(resolveConfigDir(), short)
    return c.json(room.snapshot())
  })
  .get("/:id/ws", makeCanvasWsHandler())
  .put("/:id", async (c) => {
    const short = c.req.param("id")
    const raw = await c.req.text()
    let parsed: CanvasSnapshot
    try {
      parsed = parseCanvas(JSON.parse(raw))
    } catch (err) {
      return c.json({ error: "bad_canvas", message: (err as Error).message }, 400)
    }
    const room = await getCanvasRoom(resolveConfigDir(), short)
    const stamped = await room.publish(parsed, null)
    return c.body(serializeCanvas(stamped), 200, { "Content-Type": "application/json" })
  })

export { app }
