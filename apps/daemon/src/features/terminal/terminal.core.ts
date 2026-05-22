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
    // `.kdl` extension is load-bearing: `zellij -n <arg>` treats arg as
    // either a layout NAME (looked up in the layout dir) or a layout FILE,
    // and the file path only wins when the extension is `.kdl`. Without it,
    // zellij silently falls back to the default layout and drops the
    // `pane command="bash" args claude attach <short>` directive — leaving
    // the user on a bare $SHELL pane. BSD mktemp won't expand X's when the
    // template has a trailing suffix, so reserve a unique name with `-u`
    // (no stub file) and append `.kdl` before the heredoc creates it.
    `  layout_file="$(mktemp -u "\${TMPDIR:-/tmp}/pid-zellij.XXXXXXXX").kdl"`,
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
// Python's stdlib pty + forkpty(2) lets us proxy bytes between stdin/stdout
// pipes and the slave pty. Python 3 ships on both macOS and most Linux
// distros, so we don't take a new dependency.
//
// Beyond a plain pty.spawn we need a live resize channel: the browser xterm
// can change geometry at any time but the daemon's WS messages are stdin-only,
// so we route resize out-of-band via a sizefile + SIGWINCH on the wrapper PID.
// On signal the wrapper re-reads the sizefile and applies TIOCSWINSZ on the
// master fd, which in turn delivers SIGWINCH inside the child to whatever
// program is running (zellij, the user's shell, etc.).
const PTY_PY = [
  "import pty,os,sys,fcntl,termios,struct,signal,select,errno",
  "cmd=sys.argv[1]",
  "sf=sys.argv[2] if len(sys.argv)>2 else ''",
  "def rs():",
  " try:",
  "  with open(sf) as f:",
  "   p=f.read().split()",
  "   return int(p[0]),int(p[1])",
  " except Exception:",
  "  return 24,80",
  "pid,fd=pty.fork()",
  "if pid==0:",
  " try: os.execvp('bash',['bash','-lc',cmd])",
  " except Exception as e:",
  "  sys.stderr.write('exec failed: '+str(e)+chr(10))",
  "  os._exit(127)",
  "def ap(*_):",
  " r,c=rs()",
  " try: fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',r,c,0,0))",
  " except Exception: pass",
  "ap()",
  "signal.signal(signal.SIGWINCH,ap)",
  "while True:",
  " try: rr,_,_=select.select([0,fd],[],[])",
  " except (OSError,select.error) as e:",
  "  if getattr(e,'errno',None)==errno.EINTR or (e.args and e.args[0]==errno.EINTR): continue",
  "  break",
  " if 0 in rr:",
  "  try: d=os.read(0,4096)",
  "  except OSError: break",
  "  if not d:",
  "   try: os.close(fd)",
  "   except Exception: pass",
  "   break",
  "  try: os.write(fd,d)",
  "  except OSError: break",
  " if fd in rr:",
  "  try: d=os.read(fd,4096)",
  "  except OSError: break",
  "  if not d: break",
  "  try: os.write(1,d)",
  "  except OSError: break",
].join("\n")

export const buildChildArgv = (args: {
  readonly cmd: string
  readonly pty: boolean
  readonly platform: NodeJS.Platform
  // Path the wrapper polls on SIGWINCH for the current "<rows> <cols>" pair.
  // Optional for back-compat — when omitted, the wrapper falls back to 24x80
  // and the resize channel is effectively dead (still safe to launch).
  readonly sizefile?: string
}): string[] => {
  if (!args.pty) return ["bash", "-lc", args.cmd]
  const sizefile = args.sizefile ?? ""
  return ["python3", "-c", PTY_PY, args.cmd, sizefile]
}

// "<rows> <cols>\n" — the format the wrapper's rs() expects. Centralised here
// so the daemon route writes the same shape the wrapper parses.
export const formatSizeFileContent = (args: {
  readonly cols: number
  readonly rows: number
}): string => `${args.rows} ${args.cols}\n`

// Protocol for WS frames the browser sends. Anything that isn't a valid JSON
// resize control is forwarded to the child's stdin verbatim. Resize controls
// travel as text frames so binary keystrokes stay a fast path.
//
// Bounds match the route's query-string clamps (cols ≤ 400, rows ≤ 200).
// Anything outside [1, max] (NaN, negative, huge value from a flaky client)
// degrades to input — better to type one bad keystroke than to TIOCSWINSZ a
// pty to 0×0 or 65535×65535.
export type ParsedClientMessage =
  | { readonly kind: "resize"; readonly cols: number; readonly rows: number }
  | { readonly kind: "input" }

const MAX_COLS = 400
const MAX_ROWS = 200

const inBounds = (n: unknown, max: number): n is number =>
  typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= max

export const parseClientMessage = (raw: string): ParsedClientMessage => {
  // Cheap rejection before JSON.parse: every keystroke goes through here, so
  // skip the try/catch unless the payload at least starts with '{'.
  if (raw.length < 2 || raw.charCodeAt(0) !== 0x7b) return { kind: "input" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "input" }
  }
  if (!parsed || typeof parsed !== "object") return { kind: "input" }
  const obj = parsed as Record<string, unknown>
  if (obj.type !== "resize") return { kind: "input" }
  if (!inBounds(obj.cols, MAX_COLS)) return { kind: "input" }
  if (!inBounds(obj.rows, MAX_ROWS)) return { kind: "input" }
  return { kind: "resize", cols: obj.cols, rows: obj.rows }
}

// Server → client control frames. The browser filters these out of xterm.
// JSON text frame; first byte is '{' so cheap to distinguish from inline
// error strings ("\r\n\x1b[31m…") that the daemon still writes raw.
export const HEARTBEAT_PAYLOAD = '{"type":"hb"}'

// Argv for `zellij kill-session <name>`. Pure so the route's spawn call has
// nothing to lie about in tests.
export const zellijKillSessionArgv = (sessionName: string): string[] => [
  "zellij",
  "kill-session",
  sessionName,
]

// Fast-crash window for "the zellij client panicked on startup against a wedged
// session". `zellij attach <name>` panics with EIO (Input/output error, os
// error 5) sub-second; a legitimate session — even one where `claude attach`
// fails and the layout falls back to a login shell — runs for far longer
// before any non-zero exit. 3s sits comfortably between the two.
export const FAST_CRASH_MS = 3_000

// Decide whether to auto-`zellij kill-session <name>` after a child exit.
// True iff the child crashed (non-zero) within FAST_CRASH_MS AND we know
// which session to kill. The wedged-session symptom (5,000+ EIO panics in
// the zellij log against a single `default` session) loops because the
// server-side session stays alive across panicking clients; killing it lets
// the next attach hit the create branch and rebuild from the layout.
//
// Clean exits (user typed `exit`) and long-lived sessions are never killed
// — those represent real work the user shouldn't lose.
export const shouldAutoKillSession = (args: {
  readonly elapsedMs: number
  readonly exitCode: number
  readonly sessionName: string | null
}): boolean => {
  if (args.sessionName === null) return false
  if (args.exitCode === 0) return false
  if (args.elapsedMs >= FAST_CRASH_MS) return false
  return true
}
