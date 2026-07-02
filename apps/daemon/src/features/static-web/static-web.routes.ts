import { normalize } from "node:path"
import { Hono } from "hono"
import { resolveStaticRel, staticMime } from "./static-web.core"

// Serves a pre-built SPA from `rootDir` (apps/web's Vite `dist`, bundled into
// the pid-dashboard CLI package). Mounted at "/" only when a staticDir is
// passed to buildApp() in api.ts — every other deployment (dev daemon,
// Electrobun desktop, e2e) never touches this feature.
export const buildStaticApp = (rootDir: string) => {
  const baseDir = normalize(rootDir)
  return new Hono().get("*", async (c) => {
    const rel = resolveStaticRel(c.req.path)
    if (rel === null) return c.json({ error: "bad_path" }, 400)
    const abs = normalize(`${baseDir}/${rel}`)
    if (abs !== baseDir && !abs.startsWith(`${baseDir}/`)) {
      return c.json({ error: "bad_path" }, 400)
    }
    const file = Bun.file(abs)
    if (!(await file.exists())) return c.json({ error: "not_found" }, 404)
    return new Response(file.stream(), {
      status: 200,
      headers: {
        "Content-Type": staticMime(rel),
        "Cache-Control": rel === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })
}
