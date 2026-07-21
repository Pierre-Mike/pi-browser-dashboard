// Pure helpers for the terminal feature. No I/O.

// The dashboard's global terminal tab attaches to a single shared zellij
// session named "default" — matches the user's convention for the catch-all
// session that isn't tied to any specific repo.
export const GLOBAL_ZELLIJ_SESSION = "default"

// The orchestration tab attaches to one shared zellij session — the long-lived
// voice supervisor. The name MUST equal voice-event.sh's ORCHESTRATOR_SESSION
// ("Orchestrator"): that hook types every worker's Stop/Notification event into
// the session by this name, so the supervisor the user watches here is the same
// one the fleet reports into. One per machine, not one per project.
export const ORCHESTRATOR_ZELLIJ_SESSION = "Orchestrator"

// Pick the cwd the global terminal child should spawn in. HOME when present
// (where the user's prompt expects to start), '/' otherwise — Bun.spawn rejects
// an empty cwd.
export const globalTerminalCwd = (env: Readonly<Record<string, string | undefined>>): string => {
  const home = env.HOME
  if (home && home.length > 0) return home
  return "/"
}

// Resolve the Orchestrator repo dir — the cwd the supervisor boots in. Starting
// there is what makes the session an orchestrator: the repo's CLAUDE.md is the
// supervisor instruction set, and the bootstrap's `scripts/tts_daemon.sh` is
// repo-relative. PID_ORCHESTRATOR_DIR overrides; default ~/Github/Orchestrator;
// '/' only when nothing is known (Bun.spawn rejects an empty cwd).
export const orchestratorRepoDir = (env: Readonly<Record<string, string | undefined>>): string => {
  const explicit = env.PID_ORCHESTRATOR_DIR
  if (explicit && explicit.length > 0) return explicit
  const home = env.HOME
  if (home && home.length > 0) return `${home}/Github/Orchestrator`
  return "/"
}

// Resolve the orchestrator cwd, or fail with a message instead of spawning into
// a missing directory. `Bun.spawn({ cwd })` throws synchronously on a
// nonexistent cwd; thrown from the WS onOpen handler that crashes the whole
// daemon. So we verify the repo dir exists up front (dirExists injected for
// testability) and, when it doesn't, return a reason the route turns into a
// clean WS close — the orchestrator only makes sense with its repo present.
export const resolveOrchestratorCwd = (
  env: Readonly<Record<string, string | undefined>>,
  dirExists: (path: string) => boolean,
):
  | { readonly ok: true; readonly cwd: string }
  | { readonly ok: false; readonly reason: string } => {
  const dir = orchestratorRepoDir(env)
  if (!dirExists(dir)) {
    return {
      ok: false,
      reason: `Orchestrator repo not found at ${dir} — clone it there or set PID_ORCHESTRATOR_DIR to its path.`,
    }
  }
  return { ok: true, cwd: dir }
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
// user's config to render those bars, and some configs hide them. There is
// no auto-running command pane; the content `pane` drops the user at their
// default shell so they can run `claude` (or anything else) themselves.
//
// The content pane MUST be wrapped in an explicit `tab { … }`. zellij applies
// default_tab_template only to tabs materialised through a `tab {}` block (and
// to new tabs opened at runtime); a bare `pane` at the layout root becomes an
// EMPTY first tab and demotes the template to a new-tabs-only one. The visible
// symptom is a first terminal tab with no tab bar / status bar — the zellij UI
// only appears once the user opens a second tab. Verified against zellij 0.43.1
// with `zellij -n <file> … action dump-layout`: the bare-pane layout dumps
// `tab name="Tab #1" {}` (empty) plus a new_tab_template carrying the bars,
// while `tab { pane }` injects the content through the template so tab #1
// carries the bars too.
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
    tab {
        pane
    }
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

// Bootstrap the bare orchestrator pane runs on first create:
//   1. start the Kokoro TTS daemon (idempotent — skip if already running) so
//      the supervisor can speak via scripts/say.sh;
//   2. respawn any `claude --bg` workers a machine sleep killed;
//   3. exec into claude.
// Deliberately NO `--dangerously-skip-permissions`: the daemon must not boot an
// auto-approving agent. claude starts with its normal permission gating; the
// user is watching this pane and can approve, or opt into a looser mode via
// their own claude config. Path-agnostic: scripts/tts_daemon.sh is repo-relative
// and resolves because zellijAttachOrCreate cds into orchestratorRepoDir first.
const ORCHESTRATOR_BOOTSTRAP_CMD =
  "pgrep -f tts_daemon.sh >/dev/null || (bash scripts/tts_daemon.sh & disown); " +
  "claude respawn --all >/dev/null 2>&1 || true; exec claude"

// Layout for the orchestrator session. Same tab-bar/status-bar template as the
// project/global layouts (so the zellij UI is visible), with a vertical split:
// the left pane boots the supervisor via ORCHESTRATOR_BOOTSTRAP_CMD, the right
// pane shows the `claude agents` fleet board. The bootstrap is wrapped in
// `bash -lc` (same rationale as the drill-in claude pane: a direct command pane
// gives claude a pty it rejects within seconds). The command is ASCII-safe and
// quote-free, so inlining it into the double-quoted KDL arg is safe.
const orchestratorLayoutKdl = (): string =>
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
    tab {
        pane split_direction="vertical" {
            pane name="orchestrator" command="bash" {
                args "-lc" "${ORCHESTRATOR_BOOTSTRAP_CMD}"
            }
            pane name="agents" size="40%" command="claude" {
                args "agents"
            }
        }
    }
}
`

// Orchestrator session terminal: zellij pinned to the ORCHESTRATOR_ZELLIJ_SESSION
// name. First open materialises orchestratorLayoutKdl and boots the supervisor;
// subsequent opens (and worker hooks, which also target this name) re-attach the
// same live session. cwd must be orchestratorRepoDir so the repo CLAUDE.md loads
// and the bootstrap's relative scripts/ resolve.
export const orchestratorZellijCommand = (args: { readonly cwd: string }): string =>
  zellijAttachOrCreate({
    cwd: args.cwd,
    sessionName: ORCHESTRATOR_ZELLIJ_SESSION,
    layoutKdl: orchestratorLayoutKdl(),
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
// The claude pane MUST be wrapped in an explicit `tab { … }`. zellij applies
// default_tab_template only to tabs materialised through a `tab {}` block (and
// to runtime new tabs); a bare `pane` at the layout root becomes an EMPTY first
// tab with no plugin panes and demotes the template to new-tabs-only — so the
// drill-in opens with no tab bar / status bar until a second tab is created.
// See projectLayoutKdl for the dump-layout evidence on zellij 0.43.1.
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
    tab {
        pane command="bash" {
            args "-lc" "claude attach ${short}; exec bash -l"
        }
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

// pi-<short>: the zellij session name a dispatched pi run lives in. Both the
// dispatcher (which creates the detached background session) and the terminal
// route (which attaches) derive the name from the same short, so they always
// agree on which session to talk to. `short` is piShort(id) = 8 hex chars of a
// uuid — already a safe zellij identifier, and the `pi-` prefix keeps it from
// ever colliding with a claude drill-in session named after a bare short.
export const piZellijSessionName = (short: string): string => `pi-${short}`

// Layout for the pi DISPATCH background session (the create side). The pane
// runs a launcher script the daemon wrote (`bash -l <script>`): the script
// records pi's pid then `exec pi … <intent>`, so the session's sole process IS
// pi and the session ends when pi exits. `scriptPath` is a daemon-minted
// mktemp path (no shell/KDL metacharacters), so it inlines into the KDL arg
// verbatim. Same tab-bar/status-bar template as the other layouts so the zellij
// UI is visible the moment the user attaches.
export const piBackgroundLayoutKdl = (scriptPath: string): string =>
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
    tab {
        pane command="bash" {
            args "-l" "${scriptPath}"
        }
    }
}
`

// Layout for the pi drill-in terminal (the ATTACH side), used only on the
// create branch — i.e. when the dispatch's background session has already died
// and opening the terminal resurrects it. `pi --session <id>` reopens the saved
// transcript by its (partial) uuid; `; exec bash -l` keeps the pane alive with
// any error visible if the resume fails, instead of collapsing it. The uuid is
// hex + hyphens, so it inlines into the KDL arg without escaping.
const sessionPiLayoutKdl = (sessionId: string): string =>
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
    tab {
        pane command="bash" {
            args "-lc" "pi --session ${sessionId}; exec bash -l"
        }
    }
}
`

// Drill-in terminal for a dispatched pi run: attach the live `pi-<short>`
// session the dispatcher created, or (fallback) recreate it by resuming the pi
// session from its transcript. Same attach-or-create lock/poll machinery as the
// claude drill-in — see zellijAttachOrCreate.
export const sessionPiZellijCommand = (args: {
  readonly cwd: string
  readonly sessionId: string
  readonly short: string
}): string =>
  zellijAttachOrCreate({
    cwd: args.cwd,
    sessionName: piZellijSessionName(args.short),
    layoutKdl: sessionPiLayoutKdl(args.sessionId),
  })

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
  // Detach the whole wrapper subtree (wrapper + pty child + zellij client +
  // zellij server) from the daemon's session/pgid. The daemon dev script runs
  // under `bun --watch`, which kills the daemon's process tree on every source
  // edit. Without setsid here a watch-restart cascades into every live zellij
  // session and the user loses scrollback, shell state, and claude TUIs
  // running inside. EPERM (already a session leader) is benign — swallow it.
  "try: os.setsid()",
  "except OSError: pass",
  "def rs():",
  " try:",
  "  with open(sf) as f:",
  "   p=f.read().split()",
  "   return int(p[0]),int(p[1])",
  " except Exception:",
  "  return 24,80",
  "pid,fd=pty.fork()",
  "if pid==0:",
  // Seed the controlling-tty winsize from the sizefile BEFORE exec. The parent
  // applies TIOCSWINSZ on the master fd, but only after pty.fork() returns and
  // installs the SIGWINCH handler — a window in which the just-exec'd child can
  // already be running `claude attach <short>`, which reads winsize at startup.
  // If it reads 0×0 the supervisor rejects the attach with "malformed request:
  // Too small: expected number to be >=1". rs() defaults to 24×80 and the route
  // always writes ≥1 dims, so fd 0 (the slave — the child's controlling tty)
  // gets a valid geometry here, synchronously, race-free. The parent's ap()
  // still owns live resizes via SIGWINCH on the master fd.
  " r,c=rs()",
  " try: fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',r,c,0,0))",
  " except Exception: pass",
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
