import { validateRelPath } from "../../platform/safe-path.core"
// Pure helpers for serving a pre-built SPA (apps/web's Vite `dist`) from the
// daemon. No I/O — filesystem reads live in static-web.routes.ts. Backs the
// pid-dashboard CLI's single-port distribution (see api.ts's buildApp).
//
// This slice used to keep its own 16-entry extension→MIME table and a
// `staticMime` around it. Both are gone: the routes call
// `platform/http-content.core`'s `mimeFromPath`, the repo's one table.

import { extname } from "node:path"

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
