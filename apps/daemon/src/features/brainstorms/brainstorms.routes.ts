import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { parseCanvas, serializeCanvas } from "../canvas/canvas.core"
import { getCanvasRoomAt } from "../canvas/canvas.repo"
import { type CanvasRoomResolver, makeCanvasWsHandler } from "../canvas/canvas.routes"
import { BrainstormsService, type BrainstormWriteError } from "./brainstorms.repo"

const errorToStatus = (e: BrainstormWriteError): 400 | 403 | 404 | 409 =>
  e === "forbidden" ? 403 : e === "invalid_name" ? 400 : e === "already_exists" ? 409 : 404

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Minimal slice of the runtime these routes call — lets a test build the app
// over a test-layer runtime and exercise the real handlers (mirrors pid-apps).
type RunPromise = <A>(effect: Effect.Effect<A, never, BrainstormsService>) => Promise<A>

type DocRef = { readonly projectId: string; readonly slug: string }

// Resolve the document path (validating project + slug) and hang a shared
// canvas room off it. Throwing refuses the caller: HTTP routes map the message
// back to a status; the WS handler closes the socket.
const resolveDocFile = async (run: RunPromise, ref: DocRef): Promise<string> => {
  const r = await run(
    Effect.flatMap(BrainstormsService, (s) => s.resolveFile(ref.projectId, ref.slug)).pipe(
      Effect.either,
    ),
  )
  if (r._tag === "Left") throw new Error(r.left)
  return r.right
}

const brainstormRoom =
  (run: RunPromise): CanvasRoomResolver =>
  async (c) => {
    const file = await resolveDocFile(run, {
      projectId: c.req.param("id") ?? "",
      slug: c.req.param("slug") ?? "",
    })
    return getCanvasRoomAt(file)
  }

const docErrorStatus = (err: unknown): 403 | 404 =>
  err instanceof Error && err.message === "forbidden" ? 403 : 404

// Mounted under the projects router: routes are leaf-relative and read the
// project id from the parent `:id` param.
//   GET  /projects/:id/brainstorms            -> list the project's brainstorms
//   POST /projects/:id/brainstorms            -> create one { name }
//   GET  /projects/:id/brainstorms/:slug      -> current canvas snapshot
//   POST /projects/:id/brainstorms/:slug      -> publish a canvas snapshot
//   GET  /projects/:id/brainstorms/:slug/ws   -> live canvas sync (WebSocket)
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
      const name = body.name
      const r = await run(
        Effect.flatMap(BrainstormsService, (s) => s.create(c.req.param("id"), name)).pipe(
          Effect.either,
        ),
      )
      return r._tag === "Left"
        ? c.json({ error: r.left }, errorToStatus(r.left))
        : c.json(r.right, 201)
    })
    .get("/:id/brainstorms/:slug/ws", makeCanvasWsHandler(brainstormRoom(run)))
    .get("/:id/brainstorms/:slug", async (c) => {
      let file: string
      try {
        file = await resolveDocFile(run, {
          projectId: c.req.param("id"),
          slug: c.req.param("slug"),
        })
      } catch (err) {
        return c.json({ error: (err as Error).message }, docErrorStatus(err))
      }
      const room = await getCanvasRoomAt(file)
      return c.json(room.snapshot())
    })
    .post("/:id/brainstorms/:slug", async (c) => {
      let file: string
      try {
        file = await resolveDocFile(run, {
          projectId: c.req.param("id"),
          slug: c.req.param("slug"),
        })
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
