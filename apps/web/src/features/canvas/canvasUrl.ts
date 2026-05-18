// Build the ws:// URL for the daemon canvas bridge. Pure so the test pins the
// exact path the daemon expects (`/canvas/<short>/ws`).

export type CanvasWsUrlInput = {
  readonly baseUrl: string
  readonly id: string
}

export const canvasWsUrl = ({ baseUrl, id }: CanvasWsUrlInput): string => {
  const u = new URL(baseUrl)
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  u.pathname = `/canvas/${id}/ws`
  return u.toString()
}
