// Build the ws:// URL for the daemon canvas bridge. Pure so the test pins the
// exact path the daemon expects (`/canvas/<short>/ws`).

export type CanvasWsUrlInput = {
  readonly baseUrl: string
  readonly id: string
}

export const canvasWsUrl = ({ baseUrl, id }: CanvasWsUrlInput): string => {
  const u = new URL(baseUrl)
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  // Preserve any base path (e.g. the `/__api` same-origin proxy prefix).
  const prefix = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")
  u.pathname = `${prefix}/canvas/${id}/ws`
  return u.toString()
}
