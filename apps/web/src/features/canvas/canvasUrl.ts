// Build the ws:// URL for the daemon canvas bridge. Pure so the tests pin the
// exact paths the daemon expects: `/canvas/<short>/ws` for a session canvas,
// `/projects/<id>/brainstorms/<slug>/ws` for a project brainstorm document.

export type CanvasDocRef =
  | { readonly kind: "session"; readonly short: string }
  | { readonly kind: "brainstorm"; readonly projectId: string; readonly slug: string }

export const canvasWsPath = (ref: CanvasDocRef): string =>
  ref.kind === "session"
    ? `/canvas/${ref.short}/ws`
    : `/projects/${encodeURIComponent(ref.projectId)}/brainstorms/${ref.slug}/ws`

export type CanvasWsUrlFromPathInput = {
  readonly baseUrl: string
  readonly path: string
}

export const canvasWsUrlFromPath = ({ baseUrl, path }: CanvasWsUrlFromPathInput): string => {
  const u = new URL(baseUrl)
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  // Preserve any base path (e.g. the `/__api` same-origin proxy prefix).
  const prefix = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")
  u.pathname = `${prefix}${path}`
  return u.toString()
}

export type CanvasWsUrlInput = {
  readonly baseUrl: string
  readonly ref: CanvasDocRef
}

export const canvasWsUrl = ({ baseUrl, ref }: CanvasWsUrlInput): string =>
  canvasWsUrlFromPath({ baseUrl, path: canvasWsPath(ref) })
