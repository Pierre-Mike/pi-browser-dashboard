import { Effect } from "effect"
import { Hono, type Context as HonoContext } from "hono"
import { appRuntime } from "../../platform/runtime"
import { validateRelPath } from "../projects/projects.core"
import { PID_APP_CSP } from "./pid-apps.core"
import { PidAppsService, type PidAppWriteError } from "./pid-apps.repo"

const errorToStatus = (e: PidAppWriteError): 400 | 403 | 404 | 409 | 413 =>
  e === "forbidden"
    ? 403
    : e === "too_large"
      ? 413
      : e === "invalid_name"
        ? 400
        : e === "already_exists"
          ? 409
          : 404

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Minimal slice of the runtime these routes call — lets a test build the app over
// a test-layer runtime and exercise the real handlers (mirrors pid-settings).
type RunPromise = <A>(effect: Effect.Effect<A, never, PidAppsService>) => Promise<A>

// Everything after "/pid-apps/<appId>/" in the request path is the asset path.
const splatRel = (path: string, appId: string): string => {
  const prefix = `/pid-apps/${appId}/`
  const idx = path.indexOf(prefix)
  return idx === -1 ? "" : path.slice(idx + prefix.length)
}

// Decode + string-layer validate the asset path. Returns null to refuse (bad
// percent-encoding, or a "..", backslash, leading-"/" escape). "" is allowed and
// means "serve the app entry". Single decode is deliberate: a double-encoded
// "..%252f" decodes once to "..%2f", which still contains ".." and is rejected.
const cleanRel = (path: string, appId: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(splatRel(path, appId))
  } catch {
    return null
  }
  return decoded === "" || validateRelPath(decoded) ? decoded : null
}

// CSP + nosniff on EVERY asset response (entry HTML and sub-resources). HTML
// revalidates always so a freshly dropped page is seen immediately; static
// assets get a short cache.
const assetHeaders = (size: number, mime: string): Record<string, string> => ({
  "Content-Type": mime,
  "Content-Length": String(size),
  "Content-Security-Policy": PID_APP_CSP,
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": mime.startsWith("text/html") ? "no-cache" : "private, max-age=30",
})

const serveAsset =
  (run: RunPromise) =>
  async (c: HonoContext): Promise<Response> => {
    const appId = c.req.param("appId")
    const rel = cleanRel(c.req.path, appId)
    if (rel === null) return c.json({ error: "bad_path" }, 400)
    const r = await run(
      Effect.flatMap(PidAppsService, (s) => s.resolveAsset(c.req.param("id"), { appId, rel })).pipe(
        Effect.either,
      ),
    )
    if (r._tag === "Left") return c.json({ error: r.left }, errorToStatus(r.left))
    return new Response(Bun.file(r.right.absPath).stream(), {
      status: 200,
      headers: assetHeaders(r.right.size, r.right.mime),
    })
  }

// Mounted under the projects router: routes are leaf-relative and read the
// project id from the parent `:id` param.
//   GET  /projects/:id/pid-apps              -> list the project's pid-apps
//   POST /projects/:id/pid-apps              -> create a new pid-app { name }
//   GET  /projects/:id/pid-apps/:appId[/*]   -> stream an app asset (entry if bare)
export const createApp = (run: RunPromise) =>
  new Hono()
    .get("/:id/pid-apps", async (c) => {
      const r = await run(
        Effect.flatMap(PidAppsService, (s) => s.listApps(c.req.param("id"))).pipe(Effect.either),
      )
      return r._tag === "Left" ? c.json({ error: r.left }, errorToStatus(r.left)) : c.json(r.right)
    })
    // POST (not PUT): the CORS layer only allows GET/POST/OPTIONS cross-origin
    .post("/:id/pid-apps", async (c) => {
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
        Effect.flatMap(PidAppsService, (s) => s.createApp(c.req.param("id"), name)).pipe(
          Effect.either,
        ),
      )
      return r._tag === "Left"
        ? c.json({ error: r.left }, errorToStatus(r.left))
        : c.json(r.right, 201)
    })
    .get("/:id/pid-apps/:appId", serveAsset(run))
    .get("/:id/pid-apps/:appId/*", serveAsset(run))

const app = createApp((effect) => appRuntime.runPromise(effect))

export { app }
