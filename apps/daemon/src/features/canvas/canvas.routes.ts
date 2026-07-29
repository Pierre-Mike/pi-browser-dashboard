// The live-sync websocket shell for document rooms. It mounts no routes of its
// own any more — the only canvas documents are brainstorm boards, so
// `brainstorms.routes.ts` owns the paths and instantiates the handlers below
// per format.
import { Either } from "effect"
import type { Context } from "hono"
import { upgradeWebSocket } from "../../platform/ws"
import { type CanvasSnapshot, parseCanvas } from "./canvas.core"
import type { DocParse, DocRoom } from "./docRoom.io"

const MAX_FRAME_BYTES = 256 * 1024

type ClientFrame<S> =
  | { readonly kind: "snapshot"; readonly snapshot: S }
  | { readonly kind: "request" }

type ServerFrame<S> =
  | {
      readonly kind: "snapshot"
      readonly snapshot: S
      readonly origin: "self" | "remote"
    }
  | { readonly kind: "error"; readonly message: string }

const parseClientFrame = <S>(
  raw: unknown,
  opts: { readonly parse: DocParse<S>; readonly maxFrameBytes: number },
): ClientFrame<S> | { error: string } => {
  if (typeof raw !== "string") return { error: "frame must be a JSON string" }
  if (raw.length > opts.maxFrameBytes) {
    return { error: `frame exceeds ${Math.round(opts.maxFrameBytes / 1024)}KB cap` }
  }
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
    const decoded = opts.parse(obj.snapshot)
    return Either.isLeft(decoded)
      ? { error: `bad snapshot: ${decoded.left}` }
      : { kind: "snapshot", snapshot: decoded.right }
  }
  return { error: `unknown kind: ${String(obj.kind)}` }
}

const sendServerFrame = <S>(ws: { send: (data: string) => void }, frame: ServerFrame<S>): void => {
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

// How a WS route turns its request context into a document room. The session
// canvas resolves ~/.claude/jobs/<:id>/canvas.json; the brainstorm routes
// resolve a project-local document. A resolver throws to refuse the socket.
export type DocRoomResolver<S> = (c: Context) => Promise<DocRoom<S>>

export type DocWsOptions<S> = {
  readonly resolveRoom: DocRoomResolver<S>
  readonly parse: DocParse<S>
  readonly maxFrameBytes: number
}

// Codec-generic live-sync socket: snapshot down on open + every room change,
// snapshot up on client edits. Instantiated per document format (canvas
// below; the Excalidraw board in brainstorms.routes.ts).
export const makeDocWsHandler = <S>({ resolveRoom, parse, maxFrameBytes }: DocWsOptions<S>) =>
  upgradeWebSocket((c: Context) => {
    const tokenKey = {}
    return {
      onOpen: async (_evt, ws) => {
        let room: DocRoom<S>
        try {
          room = await resolveRoom(c)
        } catch (err) {
          sendServerFrame(ws, { kind: "error", message: (err as Error).message })
          ws.close(1011, "room_init_failed")
          return
        }
        const origin = Symbol("doc-ws")
        const unsubscribe = room.subscribe((snap, fromSelf) => {
          sendServerFrame(ws, {
            kind: "snapshot",
            snapshot: snap,
            origin: fromSelf ? "self" : "remote",
          })
        })
        ctxMap.set(tokenKey, { origin, unsubscribe })
        // Prime the client with whatever is on disk right now (or the empty
        // document if nothing has been drawn yet).
        sendServerFrame(ws, { kind: "snapshot", snapshot: room.snapshot(), origin: "remote" })
      },
      onMessage: async (evt, ws) => {
        const ctx = ctxMap.get(tokenKey)
        if (!ctx) return
        const frame = parseClientFrame(evt.data, { parse, maxFrameBytes })
        if ("error" in frame) {
          sendServerFrame(ws, { kind: "error", message: frame.error })
          return
        }
        let room: DocRoom<S>
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

export type CanvasRoomResolver = DocRoomResolver<CanvasSnapshot>

export const makeCanvasWsHandler = (resolveRoom: CanvasRoomResolver) =>
  makeDocWsHandler({ resolveRoom, parse: parseCanvas, maxFrameBytes: MAX_FRAME_BYTES })
