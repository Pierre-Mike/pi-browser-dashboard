import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { LIBRARY_CATEGORIES, type LibraryCategory } from "./library.core"
import { type LibraryError, LibraryService } from "./library.repo"

const errorToStatus = (e: LibraryError): 403 | 404 | 422 => {
  if (e === "forbidden") return 403
  if (e === "catalog_invalid") return 422
  return 404
}

const isCategory = (s: string | undefined): s is LibraryCategory =>
  s !== undefined && (LIBRARY_CATEGORIES as readonly string[]).includes(s)

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

export { app }
