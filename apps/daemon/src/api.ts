import { join, normalize } from "node:path"
import { Hono } from "hono"
import { cors } from "hono/cors"
import * as canvasRoute from "./features/canvas/canvas.routes"
import * as claudeConfigRoute from "./features/claude-config/claude-config.routes"
import * as dispatchRoute from "./features/dispatch/dispatch.routes"
import * as dropsRoute from "./features/drops/drops.routes"
import * as eventsRoute from "./features/events/events.routes"
import * as extensionsRoute from "./features/extensions/extensions.routes"
import * as issueDriverRoute from "./features/issue-driver/issue-driver.routes"
import * as libraryRoute from "./features/library/library.routes"
import * as projectsRoute from "./features/projects/projects.routes"
import * as sessionsRoute from "./features/sessions/sessions.routes"
import * as terminalRoute from "./features/terminal/terminal.routes"
import * as uploadsRoute from "./features/uploads/uploads.routes"
import { extensionRegistry } from "./platform/extensions/registry"

const DEFAULT_ORIGINS = ["http://localhost:5173"]

// Minimal content-type map for extension static assets (iframe tier).
const EXT_MIME_BY_EXT: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  map: "application/json; charset=utf-8",
}

const extMime = (rel: string): string => {
  const dot = rel.toLowerCase().lastIndexOf(".")
  if (dot === -1) return "application/octet-stream"
  return EXT_MIME_BY_EXT[rel.toLowerCase().slice(dot + 1)] ?? "application/octet-stream"
}
const extraOrigins = (process.env.PID_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const allowedOrigins = [...DEFAULT_ORIGINS, ...extraOrigins]

const app = new Hono()
  .use(
    "*",
    cors({
      origin: allowedOrigins,
      allowHeaders: ["Content-Type", "Last-Event-ID"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    }),
  )
  .get("/health", (c) => c.json({ ok: true }))
  .route("/sessions", sessionsRoute.app)
  .route("/projects", projectsRoute.app)
  .route("/dispatch", dispatchRoute.app)
  .route("/drops", dropsRoute.app)
  .route("/events", eventsRoute.app)
  .route("/terminal", terminalRoute.app)
  .route("/canvas", canvasRoute.app)
  .route("/issue-driver", issueDriverRoute.app)
  .route("/claude-config", claudeConfigRoute.app)
  .route("/library", libraryRoute.app)
  .route("/uploads", uploadsRoute.app)
  .get("/extensions", (c) =>
    c.json(extensionRegistry.list().map((e) => extensionsRoute.extensionListEntry(e))),
  )
  // Enable/disable/grants management endpoints (POST /extensions/:name/...).
  .route("/extensions", extensionsRoute.app)
  .get("/extensions/:name/*", async (c) => {
    const name = c.req.param("name")
    const ext = extensionRegistry.get(name)
    if (!ext) return c.json({ error: "not_found" }, 404)
    // Everything after /extensions/<name>/ is the requested asset path.
    const prefix = `/extensions/${name}/`
    const idx = c.req.path.indexOf(prefix)
    const rawRel = idx === -1 ? "" : c.req.path.slice(idx + prefix.length)
    let rel: string
    try {
      rel = decodeURIComponent(rawRel)
    } catch {
      return c.json({ error: "bad_path" }, 400)
    }
    // Reject traversal / absolute escapes before touching the filesystem.
    if (!rel || rel.includes("..") || rel.includes("\\") || rel.startsWith("/")) {
      return c.json({ error: "bad_path" }, 400)
    }
    const baseDir = normalize(ext.dir)
    const abs = normalize(join(baseDir, rel))
    if (abs !== baseDir && !abs.startsWith(`${baseDir}/`)) {
      return c.json({ error: "bad_path" }, 400)
    }
    const file = Bun.file(abs)
    if (!(await file.exists())) return c.json({ error: "not_found" }, 404)
    return new Response(file.stream(), {
      status: 200,
      headers: {
        "Content-Type": extMime(rel),
        "Cache-Control": "private, max-age=30",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })

// Mount every extension's Hono app under /ext/<name>. Call this AFTER
// loadExtensions() has populated the registry — at module load the registry is
// empty, so calling it here would mount nothing.
export const mountExtensions = (appInstance: Hono): void => {
  for (const m of extensionRegistry.mounts()) {
    appInstance.route(m.basePath, m.app)
  }
}

export type AppType = typeof app
export { websocket } from "./platform/ws"
export { app }
export default app
