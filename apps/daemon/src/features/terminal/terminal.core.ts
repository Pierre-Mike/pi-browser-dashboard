// Pure helpers for the terminal feature. No I/O.

// The dashboard's global terminal tab attaches to a single shared zellij
// session named "default" — matches the user's convention for the catch-all
// session that isn't tied to any specific repo.
export const GLOBAL_ZELLIJ_SESSION = "default"

// Pick the cwd the global terminal child should spawn in. HOME when present
// (where the user's prompt expects to start), '/' otherwise — Bun.spawn rejects
// an empty cwd.
export const globalTerminalCwd = (env: Readonly<Record<string, string | undefined>>): string => {
  const home = env.HOME
  if (home && home.length > 0) return home
  return "/"
}

// Reduce a project id to a zellij session name. Zellij names mostly accept
// printable chars but trip on whitespace and shell-special chars, so collapse
// everything outside [A-Za-z0-9._-] to '-'. Case is preserved: `zellij
// list-sessions` and the `grep -qx` match downstream are both case-sensitive,
// and the user's repo dirs (e.g. `Orchestrator`) are conventionally also their
// zellij session names — lowercasing here makes attach miss the existing
// session, and zellij refuses to create a case-colliding twin.
export const zellijSessionName = (rawId: string): string | null => {
  const cleaned = rawId
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
  if (cleaned.length === 0) return null
  return cleaned.slice(0, 64)
}

// Drop the per-session markers ZELLIJ / ZELLIJ_SESSION_NAME / ZELLIJ_PANE_ID
// before forwarding env to a child. If the daemon runs inside a zellij pane
// (common in dev) those vars leak and `zellij attach <same-name>` panics with
// "trying to attach to the current session".
//
// Keep ZELLIJ_SOCKET_DIR (and any other ZELLIJ_* config paths) untouched — the
// child needs them to talk to the user's zellij daemon. Stripping them sends
// the child to a different socket dir where it sees zero sessions.
const ZELLIJ_SESSION_KEYS = new Set(["ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID"])

export const cleanZellijEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (ZELLIJ_SESSION_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

// Bash-single-quote escape: wrap in single quotes, replace embedded ' with
// '\''. Safe for any byte string in a POSIX shell.
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

// Bash one-liner: cd into the project, then either re-attach an existing zellij
// session by name or spawn a fresh bare session. `exec` so the child slot is
// replaced — closing the WS kills the zellij client, but zellij's daemon keeps
// the session alive for the next attach.
//
// No layout: the project session boots into the user's default shell with
// zellij's tab bar visible. The user runs `claude` (or anything else)
// themselves. An earlier version passed a single-pane layout that auto-ran
// `claude`, which swallowed the zellij UI — one pane, no tab bar — and made
// the tab indistinguishable from running claude bare.
export const projectZellijCommand = (args: {
  readonly cwd: string
  readonly sessionName: string
}): string => {
  const cwd = shq(args.cwd)
  const name = shq(args.sessionName)
  return [
    `cd ${cwd}`,
    `if zellij list-sessions -s 2>/dev/null | grep -qx ${name}; then`,
    `  exec zellij attach ${name}`,
    "else",
    `  exec zellij -s ${name}`,
    "fi",
  ].join("\n")
}

// Drill-in session terminal: same bare-zellij shape as the project terminal,
// keyed off the daemon session's short id. Earlier versions exec'd
// `claude attach <short>` directly — the tab had no zellij UI and no room
// for a second pane (tail logs, run tests) next to the claude TUI. Wrapping
// in zellij brings the tab bar back; the user runs `claude attach <short>`
// themselves (the session card has a copy button for that exact command).
//
// Returns null when `short` sanitises to an empty zellij name — the route
// translates that into an `invalid_id` reason rather than spawning a
// nameless session.
export const sessionZellijCommand = (args: {
  readonly cwd: string
  readonly short: string
}): string | null => {
  const sessionName = zellijSessionName(args.short)
  if (sessionName === null) return null
  return projectZellijCommand({ cwd: args.cwd, sessionName })
}

// Bun.spawn only gives us pipes, never a pty. zellij refuses to enable raw
// mode without a controlling tty and panics on attach. We need a pty allocator
// that does NOT require stdin to already be a tty — macOS BSD script(1) does
// a tcgetattr on stdin at startup and bails on pipes, so it's unusable here.
//
// Python's stdlib `pty.spawn` calls forkpty(2) and proxies bytes between its
// own stdin/stdout and the pty master, so pipes work. Python 3 ships on both
// macOS and most Linux distros, so we don't take a new dependency.
//
// Inside the child the default pty size is 0×0; the caller must run
// `stty rows … cols …` before launching the size-sensitive program.
const PTY_PY = "import pty,sys;pty.spawn(['bash','-lc',sys.argv[1]])"

export const buildChildArgv = (args: {
  readonly cmd: string
  readonly pty: boolean
  readonly platform: NodeJS.Platform
}): string[] => {
  if (!args.pty) return ["bash", "-lc", args.cmd]
  return ["python3", "-c", PTY_PY, args.cmd]
}
