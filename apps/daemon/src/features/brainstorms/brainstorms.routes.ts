import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { parseCanvas, serializeCanvas } from "../canvas/canvas.core"
import { getCanvasRoomAt } from "../canvas/canvas.repo"
import {
  type CanvasRoomResolver,
  makeCanvasWsHandler,
  makeDocWsHandler,
} from "../canvas/canvas.routes"
import { parseExcalidrawDoc, serializeExcalidrawDoc } from "../canvas/excalidraw.core"
import { getExcalidrawRoomAt } from "../canvas/excalidraw.repo"
import type { BrainstormKind } from "./brainstorms.core"
import { BrainstormsService, type BrainstormWriteError } from "./brainstorms.repo"

// Excalidraw scenes carry freedraw point arrays, so a board frame can dwarf a
// React-Flow canvas frame — give the doc socket a roomier cap than the 256KB
// canvas one.
const EXCALIDRAW_MAX_FRAME_BYTES = 4 * 1024 * 1024

const errorToStatus = (e: BrainstormWriteError): 400 | 403 | 404 | 409 =>
  e === "forbidden" ? 403 : e === "invalid_name" ? 400 : e === "already_exists" ? 409 : 404

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// The optional POST-body kind: absent means the original canvas document.
const parseCreateKind = (raw: unknown): BrainstormKind | null =>
  raw === undefined || raw === "canvas" ? "canvas" : raw === "excalidraw" ? "excalidraw" : null

// Minimal slice of the runtime these routes call — lets a test build the app
// over a test-layer runtime and exercise the real handlers (mirrors pid-apps).
type RunPromise = <A>(effect: Effect.Effect<A, never, BrainstormsService>) => Promise<A>

type DocRef = { readonly projectId: string; readonly slug: string; readonly kind: BrainstormKind }

// Resolve the document path (validating project + slug + kind) and hang a
// shared room off it. Throwing refuses the caller: HTTP routes map the message
// back to a status; the WS handler closes the socket.
const resolveDocFile = async (run: RunPromise, ref: DocRef): Promise<string> => {
  const r = await run(
    Effect.flatMap(BrainstormsService, (s) => s.resolveFile(ref)).pipe(Effect.either),
  )
  if (r._tag === "Left") throw new Error(r.left)
  return r.right
}

const docRefFromParams = (
  c: { req: { param: (k: "id" | "slug") => string | undefined } },
  kind: BrainstormKind,
): DocRef => ({
  projectId: c.req.param("id") ?? "",
  slug: c.req.param("slug") ?? "",
  kind,
})

const brainstormRoom =
  (run: RunPromise): CanvasRoomResolver =>
  async (c) =>
    getCanvasRoomAt(await resolveDocFile(run, docRefFromParams(c, "canvas")))

const excalidrawRoom =
  (run: RunPromise) => async (c: { req: { param: (k: "id" | "slug") => string | undefined } }) =>
    getExcalidrawRoomAt(await resolveDocFile(run, docRefFromParams(c, "excalidraw")))

const docErrorStatus = (err: unknown): 403 | 404 =>
  err instanceof Error && err.message === "forbidden" ? 403 : 404

// Mounted under the projects router: routes are leaf-relative and read the
// project id from the parent `:id` param.
//   GET  /projects/:id/brainstorms                      -> list the project's brainstorms
//   POST /projects/:id/brainstorms                      -> create one { name, kind? }
//   GET  /projects/:id/brainstorms/:slug                -> current canvas snapshot
//   POST /projects/:id/brainstorms/:slug                -> publish a canvas snapshot
//   GET  /projects/:id/brainstorms/:slug/ws             -> live canvas sync (WebSocket)
//   GET  /projects/:id/brainstorms/:slug/excalidraw     -> current Excalidraw document
//   POST /projects/:id/brainstorms/:slug/excalidraw     -> publish an Excalidraw document
//   GET  /projects/:id/brainstorms/:slug/excalidraw/ws  -> live Excalidraw sync (WebSocket)
export const createApp = (run: RunPromise) =>
  new Hono()
    .get("/:id/brainstorms", async (c) => {
      const r = await run(
        Effect.flatMap(BrainstormsService, (s) => s.list(c.req.param("id"))).pipe(Effect.either),
      )
      return r._tag === "Left" ? c.json({ error: r.left }, errorToStatus(r.left)) : c.json(r.right)
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
      const r = await run(
        Effect.flatMap(BrainstormsService, (s) =>
          s.create({ projectId: c.req.param("id"), name, kind }),
        ).pipe(Effect.either),
      )
      return r._tag === "Left"
        ? c.json({ error: r.left }, errorToStatus(r.left))
        : c.json(r.right, 201)
    })
    .get("/:id/brainstorms/:slug/ws", makeCanvasWsHandler(brainstormRoom(run)))
    .get(
      "/:id/brainstorms/:slug/excalidraw/ws",
      makeDocWsHandler({
        resolveRoom: excalidrawRoom(run),
        parse: parseExcalidrawDoc,
        maxFrameBytes: EXCALIDRAW_MAX_FRAME_BYTES,
      }),
    )
    .get("/:id/brainstorms/:slug/excalidraw", async (c) => {
      let file: string
      try {
        file = await resolveDocFile(run, docRefFromParams(c, "excalidraw"))
      } catch (err) {
        return c.json({ error: (err as Error).message }, docErrorStatus(err))
      }
      const room = await getExcalidrawRoomAt(file)
      return c.json(room.snapshot())
    })
    .post("/:id/brainstorms/:slug/excalidraw", async (c) => {
      let file: string
      try {
        file = await resolveDocFile(run, docRefFromParams(c, "excalidraw"))
      } catch (err) {
        return c.json({ error: (err as Error).message }, docErrorStatus(err))
      }
      let parsed: ReturnType<typeof parseExcalidrawDoc>
      try {
        parsed = parseExcalidrawDoc(await c.req.json())
      } catch (err) {
        return c.json({ error: "bad_document", message: (err as Error).message }, 400)
      }
      const room = await getExcalidrawRoomAt(file)
      const published = await room.publish(parsed, null)
      return c.body(serializeExcalidrawDoc(published), 200, { "Content-Type": "application/json" })
    })
    .get("/:id/brainstorms/:slug", async (c) => {
      let file: string
      try {
        file = await resolveDocFile(run, docRefFromParams(c, "canvas"))
      } catch (err) {
        return c.json({ error: (err as Error).message }, docErrorStatus(err))
      }
      const room = await getCanvasRoomAt(file)
      return c.json(room.snapshot())
    })
    .post("/:id/brainstorms/:slug", async (c) => {
      let file: string
      try {
        file = await resolveDocFile(run, docRefFromParams(c, "canvas"))
      } catch (err) {
        return c.json({ error: (err as Error).message }, docErrorStatus(err))
      }
      let parsed: ReturnType<typeof parseCanvas>
      try {
        parsed = parseCanvas(await c.req.json())
      } catch (err) {
        return c.json({ error: "bad_canvas", message: (err as Error).message }, 400)
      }
      const room = await getCanvasRoomAt(file)
      const stamped = await room.publish(parsed, null)
      return c.body(serializeCanvas(stamped), 200, { "Content-Type": "application/json" })
    })

const app = createApp((effect) => appRuntime.runPromise(effect))

export { app }
