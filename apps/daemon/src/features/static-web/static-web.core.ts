// Pure helpers for serving a pre-built SPA (apps/web's Vite `dist`) from the
// daemon. No I/O — filesystem reads live in static-web.routes.ts. Backs the
// pid-dashboard CLI's single-port distribution (see api.ts's buildApp).

import { extname } from "node:path"
import { validateRelPath } from "../projects/projects.core"

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
}

export const staticMime = (rel: string): string => {
  const ext = extname(rel).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}

// Resolve a request pathname to a relative asset path under the static root.
// An extensionless path (a client-side SPA route, e.g. "/sessions/abc") falls
// back to "index.html" so a hard refresh on a deep link still boots the app.
// Traversal-guarded via validateRelPath (shared with the extensions/pid-apps
// static routes — one rule, no drift). Returns null to refuse the request.
export const resolveStaticRel = (pathname: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const rel = decoded.replace(/^\/+/, "")
  if (rel === "") return "index.html"
  if (!validateRelPath(rel)) return null
  return extname(rel) === "" ? "index.html" : rel
}
