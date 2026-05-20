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

// Layout for the project / global zellij session. Mirrors the drill-in
// shape (default_tab_template with the tab-bar + status-bar plugins) so the
// zellij UI is always visible — bare `zellij -s <name>` depends on the
// user's config to render those bars, and some configs hide them. Unlike
// the drill-in there is no auto-running command pane; the bare `pane`
// drops the user at their default shell so they can run `claude` (or
// anything else) themselves.
const projectLayoutKdl = (): string =>
  `layout {
    default_tab_template {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        children
        pane size=2 borderless=true {
            plugin location="zellij:status-bar"
        }
    }
    pane
}
`

// Atomic lockdir wrapper around a zellij "check session, attach-or-create" flow.
// React StrictMode double-mounts TerminalView (and fast user clicks / Reconnect
// double-taps do the same shape), so two WS children for the same session name
// can be alive at once — the daemon kills the previous child only after a 1s
// grace. Without serialisation both children pass the `grep -qx <name>` check,
// both run `zellij -s <name> -n <file>`, the loser errors "session already
// exists" and the user sees `child exited (1)` in xterm with no zellij UI.
//
// mkdir(2) is atomic on every POSIX fs, so we use a per-session lockdir to
// serialise the critical section. macOS doesn't ship flock(1), and pulling in
// a new dep for this is overkill.
//
// On the *attach* branch the lock is released immediately — the session
// already exists, no waiter can race us. On the *create* branch the lock must
// outlive `exec` (which replaces the shell). We can't poll-then-exec in the
// foreground, so a backgrounded subshell polls `list-sessions` until the new
// session appears, then rmdir's the lock. A second waker that wakes up while
// the create is in flight blocks on the lockdir, wakes after registration, and
// falls through to attach.
//
// Both branches are passed as parameters so projectZellijCommand and
// sessionZellijCommand can share the wrapper while keeping their own
// layout shapes.
const zellijAttachOrCreate = (args: {
  readonly cwd: string
  readonly sessionName: string // already sanitised to [A-Za-z0-9._-]
  readonly layoutKdl: string
}): string => {
  const cwd = shq(args.cwd)
  const name = shq(args.sessionName)
  return [
    `cd ${cwd}`,
    `lock="\${TMPDIR:-/tmp}/pid-zellij-${args.sessionName}.lock"`,
    "i=0",
    `while ! mkdir "$lock" 2>/dev/null; do`,
    "  i=$((i+1))",
    `  [ "$i" -gt 100 ] && break`,
    "  sleep 0.05",
    "done",
    `if zellij list-sessions -s 2>/dev/null | grep -qx ${name}; then`,
    `  rmdir "$lock" 2>/dev/null`,
    `  exec zellij attach ${name}`,
    "else",
    `  layout_file="$(mktemp "\${TMPDIR:-/tmp}/pid-zellij.XXXXXXXX")"`,
    `  cat > "$layout_file" <<'PID_LAYOUT_EOF'`,
    args.layoutKdl.trimEnd(),
    "PID_LAYOUT_EOF",
    "  (",
    "    j=0",
    `    while [ "$j" -lt 50 ]; do`,
    `      if zellij list-sessions -s 2>/dev/null | grep -qx ${name}; then break; fi`,
    "      j=$((j+1))",
    "      sleep 0.1",
    "    done",
    `    rmdir "$lock" 2>/dev/null`,
    "  ) &",
    `  exec zellij -s ${name} -n "$layout_file"`,
    "fi",
  ].join("\n")
}

// Bash one-liner: cd into the project, then either re-attach an existing zellij
// session by name or spawn a fresh session with the project layout. `exec` so
// the child slot is replaced — closing the WS kills the zellij client, but
// zellij's daemon keeps the session alive for the next attach.
//
// First open: bash materialises the layout KDL via mktemp + heredoc, then
// `exec zellij -s <name> -n <file>`. Subsequent opens: plain attach —
// re-applying the layout would stack extra default panes on the live session.
// See zellijAttachOrCreate for the lock that serialises the if/else.
export const projectZellijCommand = (args: {
  readonly cwd: string
  readonly sessionName: string
}): string =>
  zellijAttachOrCreate({
    cwd: args.cwd,
    sessionName: args.sessionName,
    layoutKdl: projectLayoutKdl(),
  })

// Layout for the drill-in zellij session. Two requirements pull against
// each other here:
//   1. Auto-run `claude attach <short>` so the terminal tab "just works"
//      the moment the user opens it (prior shape made them type it).
//   2. Keep zellij's tab bar / status bar visible so a second pane can be
//      opened alongside the claude TUI.
//
// `default_tab_template` is the load-bearing piece: without it, a layout
// with a single top-level `pane` hides the tab/status bars and looks
// identical to running claude bare — which is why an earlier auto-attach
// shape was reverted.
//
// The command is wrapped in `bash -lc`, not run directly as `command="claude"`.
// Directly invoking `claude` from a zellij pane produces a pty that claude
// rejects within a few seconds; wrapping in bash gives claude the
// controlling-tty shape it expects and the process stays alive across
// reconnects.
//
// `claude attach <short>; exec bash -l` — drop into a login shell on exit
// (clean or otherwise). The previous shape was `close_on_exit true`, but if
// `claude attach` fails immediately (e.g. supervisor still registering the
// short on first drill-in), the pane collapses and the next reconnect lands
// on a stripped session with no claude pane. The shell fallback keeps the
// pane alive with the failure output visible so the user can retry.
const sessionClaudeLayoutKdl = (short: string): string =>
  `layout {
    default_tab_template {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        children
        pane size=2 borderless=true {
            plugin location="zellij:status-bar"
        }
    }
    pane command="bash" {
        args "-lc" "claude attach ${short}; exec bash -l"
    }
}
`

// Drill-in session terminal: zellij keyed by short, auto-running
// `claude attach <short>` in the first pane.
//
// First open: bash materialises the layout KDL to a temp file via
// mktemp + heredoc, then `exec zellij -s <name> -n <file>`. (`--layout-string`
// is misleading per projectZellijCommand notes; `-n <file>` is the only path
// that actually applies a layout when creating a session.)
//
// Subsequent opens: the session already exists with claude running, so
// `exec zellij attach <name>` is enough — re-applying the layout would
// stack a second claude TUI on top of the live one.
//
// Heredoc safety: `sessionName` already passed through zellijSessionName
// (restricted to [A-Za-z0-9._-]). Inlining into a double-quoted KDL string
// inside a single-quoted heredoc is safe.
//
// Returns null when `short` sanitises to an empty zellij name — the route
// translates that into an `invalid_id` reason.
export const sessionZellijCommand = (args: {
  readonly cwd: string
  readonly short: string
}): string | null => {
  const sessionName = zellijSessionName(args.short)
  if (sessionName === null) return null
  return zellijAttachOrCreate({
    cwd: args.cwd,
    sessionName,
    layoutKdl: sessionClaudeLayoutKdl(sessionName),
  })
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
