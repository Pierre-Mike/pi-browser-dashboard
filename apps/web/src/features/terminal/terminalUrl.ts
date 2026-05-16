// Build the ws:// URL for the daemon terminal bridge. Two kinds:
//   - "session": /terminal/<short>          → bash + claude attach <short>
//   - "project": /terminal/project/<id>     → bash + zellij attach/create + claude
// Pure so the test pins the exact path/query the daemon expects.
export type TerminalKind = "session" | "project"

export type TerminalWsUrlInput = {
  readonly baseUrl: string
  readonly kind: TerminalKind
  readonly id: string
  readonly cols: number
  readonly rows: number
}

const pathFor = (kind: TerminalKind, id: string): string =>
  kind === "session" ? `/terminal/${id}` : `/terminal/project/${id}`

export const terminalWsUrl = ({ baseUrl, kind, id, cols, rows }: TerminalWsUrlInput): string => {
  const u = new URL(baseUrl)
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  u.pathname = pathFor(kind, id)
  u.searchParams.set("cols", String(cols))
  u.searchParams.set("rows", String(rows))
  return u.toString()
}
