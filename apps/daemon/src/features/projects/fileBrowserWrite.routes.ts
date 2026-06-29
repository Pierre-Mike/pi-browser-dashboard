// Project filesystem mutations behind the file-tree context menu and drag-drop.
// Mounted under /projects alongside the read-only projects router (api.ts) so
// the pristine read routes stay untouched — this file owns the write surface.

import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { type FsResponse, runFsCreate, runFsDelete, runFsMove } from "./fileBrowser.routes"
import { ProjectsService, resolveProjectDir } from "./projects.repo"

// Resolve a project id to its absolute root via the shared resolver, or null.
const projectRoot = (id: string): Promise<string | null> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const svc = yield* ProjectsService
      return yield* resolveProjectDir(svc, id)
    }).pipe(Effect.orElseSucceed(() => null)),
  )

// Resolve the project root (404 if unknown), read the JSON body tolerantly,
// dispatch the guarded write op, and echo its mapped status.
const fsRoute =
  (run: (root: string, body: unknown) => Promise<FsResponse>) =>
  // biome-ignore lint/suspicious/noExplicitAny: Hono Context generics vary per route
  async (c: any): Promise<Response> => {
    const root = await projectRoot(c.req.param("id"))
    if (!root) return c.json({ error: "project not found" }, 404)
    const body = await c.req.json().catch(() => ({}))
    const { status, body: out } = await run(root, body)
    return c.json(out, status)
  }

export const app = new Hono()
  .post("/:id/fs/create", fsRoute(runFsCreate))
  .post("/:id/fs/move", fsRoute(runFsMove))
  .post("/:id/fs/delete", fsRoute(runFsDelete))
