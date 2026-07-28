// Build the ws:// URL for the daemon canvas bridge. Pure so the tests pin the
// exact paths the daemon expects: `/canvas/<short>/ws` for a session's scratch
// canvas, `/sessions/<short>/brainstorms/canvas/ws?path=<rel>` for a brainstorm
// board — any canvas file in that session's worktree, addressed by its path.

export type CanvasDocRef =
  | { readonly kind: "session"; readonly short: string }
  | { readonly kind: "board"; readonly short: string; readonly path: string }

export const canvasWsPath = (ref: CanvasDocRef): string =>
  ref.kind === "session"
    ? `/canvas/${ref.short}/ws`
    : `/sessions/${encodeURIComponent(ref.short)}/brainstorms/canvas/ws?path=${encodeURIComponent(ref.path)}`

export type CanvasWsUrlFromPathInput = {
  readonly baseUrl: string
  readonly path: string
}

export const canvasWsUrlFromPath = ({ baseUrl, path }: CanvasWsUrlFromPathInput): string => {
  const u = new URL(baseUrl)
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  // Preserve any base path (e.g. the `/__api` same-origin proxy prefix).
  const prefix = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")
  // A board route carries the document in `?path=`, so the route may bring its
  // own query string — assigning it to `pathname` would escape the "?" and
  // produce a path no route matches.
  const [pathname = "", search = ""] = path.split("?")
  u.pathname = `${prefix}${pathname}`
  u.search = search
  return u.toString()
}

export type CanvasWsUrlInput = {
  readonly baseUrl: string
  readonly ref: CanvasDocRef
}

export const canvasWsUrl = ({ baseUrl, ref }: CanvasWsUrlInput): string =>
  canvasWsUrlFromPath({ baseUrl, path: canvasWsPath(ref) })
