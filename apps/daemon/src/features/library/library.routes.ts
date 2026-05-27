import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { LIBRARY_CATEGORIES, type LibraryCategory } from "./library.core"
import { type InstallScope, type LibraryError, LibraryService } from "./library.repo"

const errorToStatus = (e: LibraryError): 400 | 403 | 404 | 409 | 422 | 500 => {
  if (e === "forbidden") return 403
  if (e === "not_found" || e === "catalog_not_found" || e === "agentic_repo_missing") return 404
  if (e === "duplicate_entry") return 409
  if (e === "git_failed") return 409
  if (e === "catalog_invalid" || e === "source_invalid" || e === "requires_cycle") return 422
  if (e === "io_failed") return 500
  return 500
}

const isCategory = (s: string | undefined): s is LibraryCategory =>
  s !== undefined && (LIBRARY_CATEGORIES as readonly string[]).includes(s)

const isScope = (s: unknown): s is InstallScope => s === "global" || s === "local"

const app = new Hono()
  .get("/catalog", async (c) => {
    const projectId = c.req.query("projectId") ?? null
    const result = await appRuntime.runPromise(
      Effect.flatMap(LibraryService, (s) => s.readCatalog(projectId)).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })
  .get("/agentic", async (c) => {
    const category = c.req.query("category")
    if (!isCategory(category)) {
      return c.json({ error: "invalid_category", categories: LIBRARY_CATEGORIES }, 400)
    }
    const result = await appRuntime.runPromise(
      Effect.flatMap(LibraryService, (s) => s.listAgenticRepo(category)).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })
  .post("/use", async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.name !== "string" || !isCategory(body.type) || !isScope(body.scope)) {
      return c.json({ error: "bad_request" }, 400)
    }
    const result = await appRuntime.runPromise(
      Effect.flatMap(LibraryService, (s) =>
        s.installEntry({
          name: body.name,
          type: body.type,
          scope: body.scope,
          projectId: typeof body.projectId === "string" ? body.projectId : null,
        }),
      ).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })
  .post("/add", async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      !body ||
      typeof body.name !== "string" ||
      !isCategory(body.type) ||
      typeof body.description !== "string" ||
      typeof body.source !== "string"
    ) {
      return c.json({ error: "bad_request" }, 400)
    }
    const requires =
      Array.isArray(body.requires) && body.requires.every((r: unknown) => typeof r === "string")
        ? (body.requires as string[])
        : undefined
    const result = await appRuntime.runPromise(
      Effect.flatMap(LibraryService, (s) =>
        s.addEntry({
          name: body.name,
          type: body.type,
          description: body.description,
          source: body.source,
          ...(requires ? { requires } : {}),
        }),
      ).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json({ entry: result.right })
  })
  .post("/push", async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.name !== "string" || !isCategory(body.type) || !isScope(body.scope)) {
      return c.json({ error: "bad_request" }, 400)
    }
    const result = await appRuntime.runPromise(
      Effect.flatMap(LibraryService, (s) =>
        s.pushEntry({
          name: body.name,
          type: body.type,
          scope: body.scope,
          projectId: typeof body.projectId === "string" ? body.projectId : null,
        }),
      ).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })
  .post("/remove", async (c) => {
    const body = await c.req.json().catch(() => null)
    if (
      !body ||
      typeof body.name !== "string" ||
      !isCategory(body.type) ||
      !isScope(body.scope) ||
      typeof body.deleteLocal !== "boolean"
    ) {
      return c.json({ error: "bad_request" }, 400)
    }
    const result = await appRuntime.runPromise(
      Effect.flatMap(LibraryService, (s) =>
        s.removeEntry({
          name: body.name,
          type: body.type,
          scope: body.scope,
          deleteLocal: body.deleteLocal,
          projectId: typeof body.projectId === "string" ? body.projectId : null,
        }),
      ).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json({ removed: true })
  })
  .post("/sync", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const scope = isScope(body?.scope) ? body.scope : undefined
    const result = await appRuntime.runPromise(
      Effect.flatMap(LibraryService, (s) =>
        s.syncAll({
          ...(scope ? { scope } : {}),
          projectId: typeof body?.projectId === "string" ? body.projectId : null,
        }),
      ).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })

export { app }
