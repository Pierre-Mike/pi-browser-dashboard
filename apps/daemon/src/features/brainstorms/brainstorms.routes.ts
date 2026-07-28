import { Either } from "effect"
import type { Context } from "hono"
import { Hono } from "hono"
import { parseCanvas, serializeCanvas } from "../canvas/canvas.core"
import { type CanvasRoom, getCanvasRoomAt, getJsonCanvasRoomAt } from "../canvas/canvas.io"
import {
  type CanvasRoomResolver,
  makeCanvasWsHandler,
  makeDocWsHandler,
} from "../canvas/canvas.routes"
import { parseExcalidrawDoc, serializeExcalidrawDoc } from "../canvas/excalidraw.core"
import { getExcalidrawRoomAt } from "../canvas/excalidraw.io"
import {
  type BrainstormEditor,
  brainstormEditorFor,
  type CreatableBrainstormKind,
} from "./brainstorms.core"
import {
  type BrainstormRef,
  type BrainstormWriteError,
  createBrainstormIn,
  listBrainstormsIn,
  resolveBrainstormIn,
} from "./brainstorms.io"

// Excalidraw scenes carry freedraw point arrays, so a board frame can dwarf a
// React-Flow canvas frame — give the doc socket a roomier cap than the 256KB
// canvas one.
const EXCALIDRAW_MAX_FRAME_BYTES = 4 * 1024 * 1024

// How a request's session id becomes the directory tree its boards live in:
// `undefined` for an unknown session, `null` for one with neither worktree nor
// cwd. Injected rather than imported so these routes never depend on the
// sessions slice — and so a test can point them at a tmp tree.
export type RootResolver = (id: string) => Promise<string | null | undefined>

type RouteError = BrainstormWriteError | "no_worktree"

const errorToStatus = (e: RouteError): 400 | 403 | 404 | 409 =>
  e === "forbidden" ? 403 : e === "invalid_name" ? 400 : e === "already_exists" ? 409 : 404

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// The optional POST-body kind: absent means a `.canvas` board. `canvasJson` is
// deliberately absent — the legacy encoding is readable but never created.
const parseCreateKind = (raw: unknown): CreatableBrainstormKind | null =>
  raw === undefined || raw === "canvas" ? "canvas" : raw === "excalidraw" ? "excalidraw" : null

// Refusals travel as a thrown Error carrying the reason string: the HTTP routes
// map it back to a status, and the WS handler closes the socket with it. Same
// contract makeDocWsHandler already expects from a room resolver.
const rootFor = async (input: {
  readonly resolveRoot: RootResolver
  readonly id: string
}): Promise<string> => {
  const root = await input.resolveRoot(input.id)
  if (root === undefined) throw new Error("not_found")
  if (root === null) throw new Error("no_worktree")
  return root
}

// Resolve `?path=` to a board of the editor this route serves. Asking the
// canvas routes for an `.excalidraw` file (or vice versa) is a not_found rather
// than a silent mis-decode.
const boardFor = async (input: {
  readonly resolveRoot: RootResolver
  readonly c: Context
  readonly editor: BrainstormEditor
}): Promise<BrainstormRef> => {
  const root = await rootFor({ resolveRoot: input.resolveRoot, id: input.c.req.param("id") ?? "" })
  const res = await resolveBrainstormIn({ root, path: input.c.req.query("path") ?? "" })
  if (!res.ok) throw new Error(res.error)
  if (brainstormEditorFor(res.value.kind) !== input.editor) throw new Error("not_found")
  return res.value
}

const ROUTE_ERRORS: readonly RouteError[] = [
  "forbidden",
  "invalid_name",
  "already_exists",
  "not_found",
  "no_worktree",
]

const thrownStatus = (err: unknown): 400 | 403 | 404 | 409 => {
  const message = err instanceof Error ? err.message : ""
  const known = ROUTE_ERRORS.find((e) => e === message)
  return known === undefined ? 404 : errorToStatus(known)
}

const thrownBody = (err: unknown): { readonly error: string } => ({
  error: err instanceof Error ? err.message : "not_found",
})

// Both canvas encodings hand back a DocRoom<CanvasSnapshot>, so the socket, the
// snapshot routes and the browser editor are shared; only the bytes differ.
const canvasRoomFor = (ref: BrainstormRef): Promise<CanvasRoom> =>
  ref.kind === "canvasJson" ? getCanvasRoomAt(ref.file) : getJsonCanvasRoomAt(ref.file)

/**
 * Mounted under the sessions router: routes are leaf-relative and read the
 * session short id from the parent `:id` param. A board is addressed by its
 * worktree-relative `?path=`, because a board is any canvas file in the tree —
 * so its path, not a slug in a blessed directory, is its identity.
 *
 *   GET  /:id/brainstorms                          -> every board in the worktree
 *   POST /:id/brainstorms                          -> create one { name, kind? }
 *   GET  /:id/brainstorms/canvas?path=             -> current canvas snapshot
 *   POST /:id/brainstorms/canvas?path=             -> publish a canvas snapshot
 *   GET  /:id/brainstorms/canvas/ws?path=          -> live canvas sync (WebSocket)
 *   GET  /:id/brainstorms/excalidraw?path=         -> current Excalidraw document
 *   POST /:id/brainstorms/excalidraw?path=         -> publish an Excalidraw document
 *   GET  /:id/brainstorms/excalidraw/ws?path=      -> live Excalidraw sync (WebSocket)
 */
export const createApp = (resolveRoot: RootResolver) => {
  const canvasBoard = (c: Context) => boardFor({ resolveRoot, c, editor: "canvas" })
  const excalidrawBoard = (c: Context) => boardFor({ resolveRoot, c, editor: "excalidraw" })
  const canvasRoom: CanvasRoomResolver = async (c) => canvasRoomFor(await canvasBoard(c))
  const excalidrawRoom = async (c: Context) => getExcalidrawRoomAt((await excalidrawBoard(c)).file)

  return (
    new Hono()
      .get("/:id/brainstorms", async (c) => {
        try {
          const root = await rootFor({ resolveRoot, id: c.req.param("id") })
          return c.json(await listBrainstormsIn(root))
        } catch (err) {
          return c.json(thrownBody(err), thrownStatus(err))
        }
      })
      // POST (not PUT): the CORS layer only allows GET/POST/OPTIONS cross-origin
      .post("/:id/brainstorms", async (c) => {
        let body: unknown
        try {
          body = await c.req.json()
        } catch {
          return c.json({ error: "invalid_body" }, 400)
        }
        if (!isObject(body) || typeof body.name !== "string") {
          return c.json({ error: "invalid_body" }, 400)
        }
        const kind = parseCreateKind(body.kind)
        if (kind === null) return c.json({ error: "invalid_kind" }, 400)
        const name = body.name
        try {
          const root = await rootFor({ resolveRoot, id: c.req.param("id") })
          const res = await createBrainstormIn({ root, name, kind })
          return res.ok
            ? c.json(res.value, 201)
            : c.json({ error: res.error }, errorToStatus(res.error))
        } catch (err) {
          return c.json(thrownBody(err), thrownStatus(err))
        }
      })
      .get("/:id/brainstorms/canvas/ws", makeCanvasWsHandler(canvasRoom))
      .get(
        "/:id/brainstorms/excalidraw/ws",
        makeDocWsHandler({
          resolveRoom: excalidrawRoom,
          parse: parseExcalidrawDoc,
          maxFrameBytes: EXCALIDRAW_MAX_FRAME_BYTES,
        }),
      )
      .get("/:id/brainstorms/canvas", async (c) => {
        try {
          const room = await canvasRoom(c)
          return c.json(room.snapshot())
        } catch (err) {
          return c.json(thrownBody(err), thrownStatus(err))
        }
      })
      .post("/:id/brainstorms/canvas", async (c) => {
        let room: CanvasRoom
        try {
          room = await canvasRoom(c)
        } catch (err) {
          return c.json(thrownBody(err), thrownStatus(err))
        }
        const parsed = parseCanvas(await c.req.json().catch(() => null))
        if (Either.isLeft(parsed)) {
          return c.json({ error: "bad_canvas", message: parsed.left }, 400)
        }
        const stamped = await room.publish(parsed.right, null)
        return c.body(serializeCanvas(stamped), 200, { "Content-Type": "application/json" })
      })
      .get("/:id/brainstorms/excalidraw", async (c) => {
        try {
          const room = await excalidrawRoom(c)
          return c.json(room.snapshot())
        } catch (err) {
          return c.json(thrownBody(err), thrownStatus(err))
        }
      })
      .post("/:id/brainstorms/excalidraw", async (c) => {
        let file: string
        try {
          file = (await excalidrawBoard(c)).file
        } catch (err) {
          return c.json(thrownBody(err), thrownStatus(err))
        }
        const parsed = parseExcalidrawDoc(await c.req.json().catch(() => null))
        if (Either.isLeft(parsed)) {
          return c.json({ error: "bad_document", message: parsed.left }, 400)
        }
        const room = await getExcalidrawRoomAt(file)
        const published = await room.publish(parsed.right, null)
        return c.body(serializeExcalidrawDoc(published), 200, {
          "Content-Type": "application/json",
        })
      })
  )
}
