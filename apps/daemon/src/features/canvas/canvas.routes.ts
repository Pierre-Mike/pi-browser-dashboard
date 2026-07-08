import type { Context } from "hono"
import { Hono } from "hono"
import { resolveConfigDir } from "../../platform/config-dir"
import { upgradeWebSocket } from "../../platform/ws"
import { type CanvasSnapshot, parseCanvas, serializeCanvas } from "./canvas.core"
import { type CanvasRoom, getCanvasRoom } from "./canvas.repo"

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

// How a WS route turns its request context into a canvas room. The session
// canvas resolves ~/.claude/jobs/<:id>/canvas.json; the brainstorm routes
// resolve a project-local document. A resolver throws to refuse the socket.
export type CanvasRoomResolver = (c: Context) => Promise<CanvasRoom>

export const makeCanvasWsHandler = (resolveRoom: CanvasRoomResolver) =>
  upgradeWebSocket((c: Context) => {
    const tokenKey = {}
    return {
      onOpen: async (_evt, ws) => {
        let room: CanvasRoom
        try {
          room = await resolveRoom(c)
        } catch (err) {
          sendServerFrame(ws, { kind: "error", message: (err as Error).message })
          ws.close(1011, "room_init_failed")
          return
        }
        const origin = Symbol("canvas-ws")
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
        let room: CanvasRoom
        try {
          room = await resolveRoom(c)
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

// The session-canvas resolver: room is the per-session canvas.json. An empty
// id (unreachable through normal routing) is refused like any resolver error.
const sessionRoom: CanvasRoomResolver = (c) => {
  const short = c.req.param("id") ?? ""
  if (!short) return Promise.reject(new Error("missing session id"))
  return getCanvasRoom(resolveConfigDir(), short)
}

const app = new Hono()
  .get("/:id", async (c) => {
    const short = c.req.param("id")
    const room = await getCanvasRoom(resolveConfigDir(), short)
    return c.json(room.snapshot())
  })
  .get("/:id/ws", makeCanvasWsHandler(sessionRoom))
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
