import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { fetchGithubSummary } from "./github.repo"
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
  .get("/:id/raw", async (c) => {
    const id = c.req.param("id")
    const path = c.req.query("path") ?? ""
    if (!path) return c.json({ error: "missing_path" }, 400)
    const result = await appRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProjectsService
        return yield* svc.resolveRaw(id, path)
      }).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    const { absPath, size, mime } = result.right
    const file = Bun.file(absPath)
    return new Response(file.stream(), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(size),
        "Cache-Control": "private, max-age=30",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })
  .get("/:id/github", async (c) => {
    const id = c.req.param("id")
    const list = await appRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProjectsService
        return yield* svc.list()
      }),
    )
    const project = list.find((p) => p.id === id)
    if (!project) return c.json({ error: "project not found" }, 404)
    if (!project.githubUrl) return c.json({ error: "project has no github origin" }, 400)
    const summary = await fetchGithubSummary(project.path)
    return c.json(summary)
  })

export { app }
