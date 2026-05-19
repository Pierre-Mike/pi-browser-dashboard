// Build the ws:// URL for the daemon terminal bridge. Three kinds:
//   - "session": /terminal/<short>          → bash + zellij attach/create '<short>'
//   - "project": /terminal/project/<id>     → bash + zellij attach/create '<id>'
//   - "global" : /terminal/global           → bash + zellij attach/create 'default'
// All three are bare zellij sessions (tab bar visible, no auto-claude); the
// user runs `claude attach <short>` themselves from inside zellij when they
// want the session TUI.
// Pure so the test pins the exact path/query the daemon expects.
export type TerminalKind = "session" | "project" | "global"

export type TerminalWsUrlInput =
  | {
      readonly baseUrl: string
      readonly kind: "session" | "project"
      readonly id: string
      readonly cols: number
      readonly rows: number
    }
  | {
      readonly baseUrl: string
      readonly kind: "global"
      readonly cols: number
      readonly rows: number
    }

const pathFor = (input: TerminalWsUrlInput): string => {
  if (input.kind === "session") return `/terminal/${input.id}`
  if (input.kind === "project") return `/terminal/project/${input.id}`
  return "/terminal/global"
}

export const terminalWsUrl = (input: TerminalWsUrlInput): string => {
  const u = new URL(input.baseUrl)
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  u.pathname = pathFor(input)
  u.searchParams.set("cols", String(input.cols))
  u.searchParams.set("rows", String(input.rows))
  return u.toString()
}
