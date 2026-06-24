import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { app as pidAppsApp } from "../pid-apps/pid-apps.routes"
import { app as pidSettingsApp } from "../pid-settings/pid-settings.routes"
import { errorToStatus, treeGitStatusAt } from "./fileBrowser.routes"
import type { TreeGitStatusEntry } from "./git.core"
import { type GitError, type GitResult, gitLog, gitPull, gitStatus } from "./git.repo"
import { fetchGithubSummary, fetchPrDiff } from "./github.repo"
import { contentDispositionAttachment } from "./projects.core"
import { ProjectsService } from "./projects.repo"

const gitErrorToStatus = (e: GitError): 404 | 500 => (e === "not_a_repo" ? 404 : 500)

// Shared shape for the /:id/git/* routes: resolve the project path (404 if
// unknown), run a GitResult-returning op, and map a GitError to its status.
// `shape` lets a route wrap the value (e.g. { commits }); defaults to identity.
const gitRoute = async <A>(
  // biome-ignore lint/suspicious/noExplicitAny: Hono Context generics vary per route
  c: any,
  {
    op,
    shape = (v) => v,
  }: { op: (path: string) => Promise<GitResult<A>>; shape?: (value: A) => unknown },
): Promise<Response> => {
  const path = await projectPath(c.req.param("id"))
  if (!path) return c.json({ error: "project not found" }, 404)
  const res = await op(path)
  if (!res.ok) return c.json({ error: res.error }, gitErrorToStatus(res.error))
  return c.json(shape(res.value))
}

// Resolve a project id to its absolute path, or null when unknown.
const projectPath = (id: string): Promise<string | null> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const svc = yield* ProjectsService
      const list = yield* svc.list()
      return list.find((p) => p.id === id)?.path ?? null
    }),
  )

// Optional git-status overlay for the file tree, mapped to @pierre/trees'
// GitStatusEntry[]. Never fails the listing: a non-repo project or a git error
// just yields no badges.
const treeGitStatus = async (id: string): Promise<readonly TreeGitStatusEntry[]> => {
  const path = await projectPath(id)
  if (!path) return []
  return treeGitStatusAt(path)
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
  .get("/:id/tree", async (c) => {
    const id = c.req.param("id")
    const tree = await appRuntime.runPromise(
      ProjectsService.pipe(
        Effect.flatMap((svc) => svc.listTree(id)),
        Effect.either,
      ),
    )
    // `?gitStatus=1` enriches the flat listing with per-path badges; without it
    // the response keeps its original `{ paths, truncated }` shape.
    const withGit = c.req.query("gitStatus") === "1"
    return tree._tag === "Left"
      ? c.json({ error: tree.left }, errorToStatus(tree.left))
      : c.json(withGit ? { ...tree.right, gitStatus: await treeGitStatus(id) } : tree.right)
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
    // `?download=1` flips the response from inline rendering to a forced
    // download that keeps the original filename (Content-Disposition wins
    // cross-origin, where the <a download> attribute is ignored).
    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=30",
      "X-Content-Type-Options": "nosniff",
    }
    if (c.req.query("download") === "1") {
      headers["Content-Disposition"] = contentDispositionAttachment(path)
    }
    return new Response(file.stream(), { status: 200, headers })
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
  .get("/:id/github/pr/:prNumber/diff", async (c) => {
    const path = await projectPath(c.req.param("id"))
    return path
      ? c.json(await fetchPrDiff(path, Number(c.req.param("prNumber"))))
      : c.json({ error: "project not found" }, 404)
  })
  .get("/:id/git/status", (c) => gitRoute(c, { op: (path) => gitStatus(path) }))
  .get("/:id/git/log", (c) => {
    const limitRaw = c.req.query("limit")
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined
    return gitRoute(c, { op: (path) => gitLog(path, limit), shape: (commits) => ({ commits }) })
  })
  .post("/:id/git/pull", (c) => gitRoute(c, { op: (path) => gitPull(path) }))
  // Per-project pid-settings live under this router: GET/POST
  // /projects/:id/pid-settings. The sub-app reads the `:id` parent param.
  .route("/", pidSettingsApp)
  // Per-project pid-apps (HTML dropped into <project>/.pid/): GET
  // /projects/:id/pid-apps and /projects/:id/pid-apps/:appId/*.
  .route("/", pidAppsApp)

export { app }
