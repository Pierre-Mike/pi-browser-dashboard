import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import type { FileError } from "./projects.repo"
import { ProjectsService } from "./projects.repo"

const errorToStatus = (e: FileError): 400 | 403 | 404 | 413 => {
  switch (e) {
    case "forbidden":
      return 403
    case "not_a_directory":
    case "not_a_file":
      return 400
    case "too_large":
      return 413
    default:
      return 404
  }
}

const app = new Hono()
  .get("/", async (c) => {
    const list = await appRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProjectsService
        return yield* svc.list()
      }),
    )
    return c.json(list)
  })
  .get("/:id/files", async (c) => {
    const id = c.req.param("id")
    const path = c.req.query("path")
    const result = await appRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProjectsService
        return yield* svc.listDir(id, path)
      }).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })
  .get("/:id/file", async (c) => {
    const id = c.req.param("id")
    const path = c.req.query("path") ?? ""
    if (!path) return c.json({ error: "missing_path" }, 400)
    const result = await appRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProjectsService
        return yield* svc.readFile(id, path)
      }).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })

export const testApp = app
export { app }
