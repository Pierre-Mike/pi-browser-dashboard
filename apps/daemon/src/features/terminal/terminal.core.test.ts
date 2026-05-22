import { describe, expect, it } from "bun:test"
import {
  FAST_CRASH_MS,
  GLOBAL_ZELLIJ_SESSION,
  HEARTBEAT_PAYLOAD,
  buildChildArgv,
  cleanZellijEnv,
  formatSizeFileContent,
  globalTerminalCwd,
  parseClientMessage,
  projectZellijCommand,
  sessionZellijCommand,
  shouldAutoKillSession,
  zellijKillSessionArgv,
  zellijSessionName,
} from "./terminal.core"

describe("zellijSessionName", () => {
  it("returns the bare repo name verbatim — no prefix, case preserved so we share the user's session", () => {
    expect(zellijSessionName("pi-browser-dashboard")).toBe("pi-browser-dashboard")
    // Case must be preserved: zellij list-sessions and `grep -qx` are
    // case-sensitive, and the user's repo dirs (e.g. `Orchestrator`) are also
    // their zellij session names.
    expect(zellijSessionName("Orchestrator")).toBe("Orchestrator")
    expect(zellijSessionName("My-Repo")).toBe("My-Repo")
  })

  it("returns null for empty / whitespace-only input", () => {
    expect(zellijSessionName("")).toBe(null)
    expect(zellijSessionName("   ")).toBe(null)
    expect(zellijSessionName("///")).toBe(null)
  })

  it("collapses runs of unsafe chars into single dashes", () => {
    expect(zellijSessionName("foo bar / baz")).toBe("foo-bar-baz")
    expect(zellijSessionName("a$$b##c")).toBe("a-b-c")
  })

  it("preserves dots and underscores", () => {
    expect(zellijSessionName("foo.bar_baz")).toBe("foo.bar_baz")
  })

  it("strips leading and trailing separators", () => {
    expect(zellijSessionName("--foo--")).toBe("foo")
    expect(zellijSessionName("..foo..")).toBe("foo")
  })

  it("caps the result at 64 chars", () => {
    const long = "a".repeat(200)
    const out = zellijSessionName(long)
    expect(out).not.toBeNull()
    if (out !== null) expect(out.length).toBeLessThanOrEqual(64)
  })
})

describe("cleanZellijEnv", () => {
  it("drops the per-session markers that trigger self-attach detection", () => {
    const out = cleanZellijEnv({
      PATH: "/usr/bin",
      ZELLIJ: "0",
      ZELLIJ_SESSION_NAME: "pi-browser-dashboard",
      ZELLIJ_PANE_ID: "12",
    })
    expect(out.PATH).toBe("/usr/bin")
    expect(out.ZELLIJ).toBeUndefined()
    expect(out.ZELLIJ_SESSION_NAME).toBeUndefined()
    expect(out.ZELLIJ_PANE_ID).toBeUndefined()
  })

  it("KEEPS ZELLIJ_SOCKET_DIR — the child needs it to find the zellij daemon", () => {
    const out = cleanZellijEnv({ ZELLIJ_SOCKET_DIR: "/var/z", ZELLIJ_SESSION_NAME: "x" })
    expect(out.ZELLIJ_SOCKET_DIR).toBe("/var/z")
    expect(out.ZELLIJ_SESSION_NAME).toBeUndefined()
  })

  it("keeps ZELLIJ_CONFIG_DIR / ZELLIJ_CONFIG_FILE (custom config paths)", () => {
    const out = cleanZellijEnv({
      ZELLIJ_CONFIG_DIR: "/cfg",
      ZELLIJ_CONFIG_FILE: "/cfg/config.kdl",
    })
    expect(out.ZELLIJ_CONFIG_DIR).toBe("/cfg")
    expect(out.ZELLIJ_CONFIG_FILE).toBe("/cfg/config.kdl")
  })

  it("drops undefined values (Node's env-shaped Record allows them)", () => {
    const out = cleanZellijEnv({ HOME: "/h", MISSING: undefined })
    expect(out.HOME).toBe("/h")
    expect("MISSING" in out).toBe(false)
  })

  it("keeps unrelated vars untouched", () => {
    const out = cleanZellijEnv({ FOO: "bar", BAZ: "qux" })
    expect(out).toEqual({ FOO: "bar", BAZ: "qux" })
  })
})

describe("projectZellijCommand", () => {
  it("cd-s into the cwd before invoking zellij", () => {
    const cmd = projectZellijCommand({ cwd: "/path/to/repo", sessionName: "foo" })
    expect(cmd.split("\n")[0]).toBe("cd '/path/to/repo'")
  })

  it("attaches when the session already exists", () => {
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    expect(cmd).toContain("zellij list-sessions -s")
    expect(cmd).toContain("grep -qx 'foo'")
    expect(cmd).toContain("exec zellij attach 'foo'")
  })

  it("creates a new session with a layout that pins zellij's tab bar visible (no auto-claude)", () => {
    // Bare `zellij -s <name>` relies on the user's config to show the tab
    // bar / status bar — some configs hide them, leaving the dashboard
    // terminal indistinguishable from a single shell pane. Mirror the
    // session drill-in shape: write a layout file with default_tab_template
    // pinning the tab-bar and status-bar plugins. Unlike the drill-in, no
    // auto-claude pane — the user picks what to run.
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    expect(cmd).toContain("mktemp")
    expect(cmd).toContain(`exec zellij -s 'foo' -n`)
    expect(cmd).toContain("default_tab_template")
    expect(cmd).toContain(`plugin location="zellij:tab-bar"`)
    expect(cmd).toContain(`plugin location="zellij:status-bar"`)
    // No auto-claude — the project terminal should drop the user at a shell.
    expect(cmd).not.toContain("claude")
  })

  it("uses exec so the bash wrapper is replaced (close → detach, not kill)", () => {
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    const attachLines = cmd.split("\n").filter((l) => l.includes("exec zellij"))
    for (const l of attachLines) {
      expect(l.trim().startsWith("exec ")).toBe(true)
    }
  })

  it("single-quote-escapes cwds containing apostrophes", () => {
    const cmd = projectZellijCommand({ cwd: "/it's/here", sessionName: "x" })
    // POSIX trick: ' → '\''  (close, escaped-quote, reopen)
    expect(cmd).toContain(`cd '/it'\\''s/here'`)
  })

  it("guards the check-then-create with a portable mkdir lock keyed by session name", () => {
    // React StrictMode double-mounts the TerminalView; the daemon's 1s child-kill
    // grace overlaps the two WS children. Without a lock both bash children pass
    // the `grep -qx <name>` check, both run `zellij -s <name> -n <file>`, the
    // loser errors "session already exists" and the user sees `child exited (1)`.
    // mkdir(2) is atomic on every POSIX fs — using it as a per-session lockdir
    // serialises the check-then-create critical section without taking a new
    // dependency (macOS doesn't ship flock).
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    // Lock path includes the (already-sanitised) session name so distinct
    // sessions don't serialise against each other.
    expect(cmd).toContain("pid-zellij-foo.lock")
    expect(cmd).toContain(`mkdir "$lock"`)
    // Attach branch: release immediately, then exec. The session already
    // exists so no concurrent waiter can race us.
    expect(cmd).toMatch(/rmdir "\$lock"[\s\S]*exec zellij attach 'foo'/)
  })

  it("releases the lock only after zellij registers the new session (backgrounded poll loop)", () => {
    // On the create branch the lock must outlive `exec`. We can't poll-then-exec
    // in the foreground (exec replaces the shell), so spawn a backgrounded
    // subshell that polls list-sessions until the new session appears and only
    // then rmdir's the lock. The next waker now sees the session in list-sessions
    // and falls through to attach instead of racing another create.
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    // Subshell is backgrounded with ` &` after a poll loop that grep's for the
    // session name and finally rmdir's the lock.
    expect(cmd).toMatch(/grep -qx 'foo'[\s\S]*rmdir "\$lock"[\s\S]*\) &/)
    // exec zellij -s … must follow the backgrounded subshell so the lock
    // releaser is still alive when zellij starts registering.
    const createIdx = cmd.indexOf(`exec zellij -s 'foo'`)
    const bgIdx = cmd.indexOf(") &")
    expect(bgIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(bgIdx)
  })
})

describe("sessionZellijCommand", () => {
  it("auto-attaches to the claude bg session while keeping zellij's tab bar visible", () => {
    // The drill-in used to exec `claude attach <short>` directly (no tab bar,
    // no room for a second pane); then dropped auto-attach entirely because
    // the layout used didn't include default_tab_template and swallowed the
    // zellij UI. This shape keeps both: default_tab_template restores the
    // tab bar / status bar, and the first pane auto-runs `claude attach`.
    const cmd = sessionZellijCommand({ cwd: "/wt", short: "abcd1234" })
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    expect(cmd).toContain("cd '/wt'")
    expect(cmd).toContain("zellij list-sessions -s")
    expect(cmd).toContain("grep -qx 'abcd1234'")
    // Existing session: plain attach (claude is already running in the pane
    // from first open — re-running it would stack TUIs).
    expect(cmd).toContain("exec zellij attach 'abcd1234'")
    // New session: layout file written via mktemp + heredoc, then `-n <file>`.
    expect(cmd).toContain("mktemp")
    expect(cmd).toContain("exec zellij -s 'abcd1234' -n")
    // Layout must include default_tab_template so the tab bar is visible.
    expect(cmd).toContain("default_tab_template")
    expect(cmd).toContain(`plugin location="zellij:tab-bar"`)
    expect(cmd).toContain(`plugin location="zellij:status-bar"`)
    // Layout must auto-run `claude attach <short>` wrapped in `bash -lc`.
    // Direct `command="claude"` produces a pty that claude rejects, so the
    // TUI paints once and the pane collapses within seconds — leaving the
    // user on an empty shell pane after the next reconnect.
    expect(cmd).toContain(`pane command="bash"`)
    expect(cmd).not.toContain(`pane command="claude"`)
  })

  it("survives a failing `claude attach` — falls back to a login shell instead of collapsing the pane", () => {
    // `close_on_exit true` was the previous shape. If `claude attach <short>`
    // fails (e.g. supervisor hasn't finished registering the short yet on
    // first drill-in), the pane closes immediately — leaving a tab-bar-only
    // session with no claude pane. The next reconnect attaches to that
    // stripped session and the user has to retype `claude attach` themselves.
    // Chain `; exec bash -l` so failure / clean-exit drops to a shell with
    // any diagnostics visible. No close_on_exit on the pane.
    const cmd = sessionZellijCommand({ cwd: "/wt", short: "abcd1234" })
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    expect(cmd).toContain(`args "-lc" "claude attach abcd1234; exec bash -l"`)
    expect(cmd).not.toContain("close_on_exit true")
  })

  it("guards the check-then-create with a portable mkdir lock keyed by session name", () => {
    // Same race as projectZellijCommand: StrictMode double-mount → two bash
    // children both see "no session", both try `zellij -s -n`, the loser
    // panics. mkdir lockdir serialises the critical section.
    const cmd = sessionZellijCommand({ cwd: "/wt", short: "abcd1234" })
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    expect(cmd).toContain("pid-zellij-abcd1234.lock")
    expect(cmd).toContain(`mkdir "$lock"`)
    expect(cmd).toMatch(/rmdir "\$lock"[\s\S]*exec zellij attach 'abcd1234'/)
  })

  it("releases the lock only after zellij registers the new drill-in session (backgrounded poll loop)", () => {
    const cmd = sessionZellijCommand({ cwd: "/wt", short: "abcd1234" })
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    expect(cmd).toMatch(/grep -qx 'abcd1234'[\s\S]*rmdir "\$lock"[\s\S]*\) &/)
    const createIdx = cmd.indexOf(`exec zellij -s 'abcd1234'`)
    const bgIdx = cmd.indexOf(") &")
    expect(bgIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(bgIdx)
  })

  it("returns null when the short sanitises to empty (route surfaces invalid_id)", () => {
    expect(sessionZellijCommand({ cwd: "/wt", short: "" })).toBeNull()
    expect(sessionZellijCommand({ cwd: "/wt", short: "///" })).toBeNull()
  })

  it("writes the layout file with a .kdl extension so `zellij -n <file>` parses it as a layout", () => {
    // zellij -n's arg is ambiguous: "Name of a predefined layout … or the path
    // to a layout file". Without a .kdl extension, zellij treats the arg as a
    // NAME, looks it up in the layout dir, fails to find it, and silently
    // falls back to the default layout (single $SHELL pane). The
    // `pane command="bash" args claude attach <short>` directive is dropped
    // entirely and the user lands on a bare zsh prompt — exactly the bug
    // that made every drill-in require typing `claude attach` manually.
    // BSD mktemp doesn't accept a template-with-suffix, so use `mktemp -u`
    // to reserve a unique name without creating the stub file, then append
    // `.kdl` and let the heredoc create it.
    const cmd = sessionZellijCommand({ cwd: "/wt", short: "abcd1234" })
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    expect(cmd).toMatch(/layout_file="\$\(mktemp -u [^)]+\)\.kdl"/)
    expect(cmd).toMatch(/exec zellij -s 'abcd1234' -n "\$layout_file"/)
  })

  it("single-quote-escapes the cwd", () => {
    const cmd = sessionZellijCommand({ cwd: "/it's/here", short: "x" })
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    expect(cmd).toContain(`cd '/it'\\''s/here'`)
  })

  it("inlines the sanitised short into the KDL — sanitiser keeps it within [A-Za-z0-9._-] so no string escaping is needed", () => {
    const cmd = sessionZellijCommand({ cwd: "/wt", short: "weird name!" })
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    expect(cmd).toContain(`args "-lc" "claude attach weird-name; exec bash -l"`)
  })
})

describe("GLOBAL_ZELLIJ_SESSION", () => {
  it("is the literal string 'default' — the user's convention for the catch-all session", () => {
    expect(GLOBAL_ZELLIJ_SESSION).toBe("default")
  })

  it("survives zellijSessionName unchanged — already a safe zellij identifier", () => {
    expect(zellijSessionName(GLOBAL_ZELLIJ_SESSION)).toBe(GLOBAL_ZELLIJ_SESSION)
  })
})

describe("globalTerminalCwd", () => {
  it("returns HOME when set", () => {
    expect(globalTerminalCwd({ HOME: "/Users/me" })).toBe("/Users/me")
  })

  it("falls back to '/' when HOME is unset (daemon must always spawn somewhere)", () => {
    expect(globalTerminalCwd({})).toBe("/")
    expect(globalTerminalCwd({ HOME: undefined })).toBe("/")
  })

  it("falls back to '/' when HOME is empty — empty cwd would crash bash", () => {
    expect(globalTerminalCwd({ HOME: "" })).toBe("/")
  })
})

describe("buildChildArgv", () => {
  it("pty=false → plain bash -lc (back-compat for the session route)", () => {
    expect(buildChildArgv({ cmd: "echo hi", pty: false, platform: "darwin" })).toEqual([
      "bash",
      "-lc",
      "echo hi",
    ])
  })

  it("pty=true → python3 wrapper, cmd as argv[1], sizefile as argv[2]", () => {
    // BSD script(1) wants stdin to be a tty; we have a pipe. python3 + forkpty
    // gives the child a pty even though our stdin/stdout are pipes. argv[2] is
    // the sizefile the wrapper re-reads on SIGWINCH — the browser-triggered
    // resize channel hangs off this contract.
    const argv = buildChildArgv({
      cmd: "zellij attach foo",
      pty: true,
      platform: "darwin",
      sizefile: "/tmp/pid-term-abc.size",
    })
    expect(argv[0]).toBe("python3")
    expect(argv[1]).toBe("-c")
    // The wrapper must install a SIGWINCH handler AND call ioctl with
    // TIOCSWINSZ on the master pty fd — without both, browser resize is dead.
    expect(argv[2]).toContain("pty.fork")
    expect(argv[2]).toContain("SIGWINCH")
    expect(argv[2]).toContain("TIOCSWINSZ")
    expect(argv[3]).toBe("zellij attach foo")
    expect(argv[4]).toBe("/tmp/pid-term-abc.size")
  })

  it("pty=true without sizefile still launches — wrapper falls back to 24×80", () => {
    // Back-compat: old callers (and unit tests of unrelated features) pass no
    // sizefile. The wrapper must read_size() → (24,80) when argv[2] is the
    // empty string; the route writes a real sizefile in production.
    const argv = buildChildArgv({ cmd: "true", pty: true, platform: "darwin" })
    expect(argv.length).toBe(5)
    expect(argv[4]).toBe("")
  })

  it("pty=true argv is platform-agnostic (same on darwin and linux)", () => {
    const darwin = buildChildArgv({ cmd: "x", pty: true, platform: "darwin", sizefile: "/s" })
    const linux = buildChildArgv({ cmd: "x", pty: true, platform: "linux", sizefile: "/s" })
    expect(darwin).toEqual(linux)
  })
})

describe("formatSizeFileContent", () => {
  it("writes rows then cols separated by a space, trailing newline", () => {
    // The wrapper splits on whitespace and reads (rows, cols) in that order —
    // mismatching the order flips the pty geometry. Pin the exact shape.
    expect(formatSizeFileContent({ cols: 120, rows: 32 })).toBe("32 120\n")
    expect(formatSizeFileContent({ cols: 80, rows: 24 })).toBe("24 80\n")
  })
})

describe("parseClientMessage", () => {
  it("ascii input passes through as 'input' without trying JSON.parse", () => {
    // Hot path: every keystroke. Must not allocate a try/catch frame for a
    // bare character.
    expect(parseClientMessage("a")).toEqual({ kind: "input" })
    expect(parseClientMessage("hello")).toEqual({ kind: "input" })
    expect(parseClientMessage("\x1b[A")).toEqual({ kind: "input" })
  })

  it("malformed JSON degrades to input — never throws to the WS handler", () => {
    // A user pastes JSON-shaped text into the terminal; we must forward it to
    // the child, not crash the bridge.
    expect(parseClientMessage("{not valid")).toEqual({ kind: "input" })
    expect(parseClientMessage("{}{}")).toEqual({ kind: "input" })
  })

  it("recognises a well-formed resize control", () => {
    expect(parseClientMessage('{"type":"resize","cols":120,"rows":32}')).toEqual({
      kind: "resize",
      cols: 120,
      rows: 32,
    })
  })

  it("rejects out-of-bounds dims (cols > 400, rows > 200, zero, negative)", () => {
    // TIOCSWINSZ with absurd dims either errors or wedges the pty; clamp at
    // the same ceiling as the query-string parser (400×200) and reject < 1.
    expect(parseClientMessage('{"type":"resize","cols":9999,"rows":24}')).toEqual({
      kind: "input",
    })
    expect(parseClientMessage('{"type":"resize","cols":80,"rows":9999}')).toEqual({
      kind: "input",
    })
    expect(parseClientMessage('{"type":"resize","cols":0,"rows":24}')).toEqual({ kind: "input" })
    expect(parseClientMessage('{"type":"resize","cols":-1,"rows":24}')).toEqual({ kind: "input" })
  })

  it("ignores unknown control types — forwards as input", () => {
    // Forward-compat: a future client sending {type:"foo"} must not silently
    // drop the bytes from the child's stdin perspective; degrade to input.
    expect(parseClientMessage('{"type":"foo"}')).toEqual({ kind: "input" })
  })

  it("rejects fractional dims — TIOCSWINSZ takes ushort, not float", () => {
    expect(parseClientMessage('{"type":"resize","cols":120.5,"rows":32}')).toEqual({
      kind: "input",
    })
  })
})

describe("HEARTBEAT_PAYLOAD", () => {
  it("is a JSON text frame starting with '{' — distinguishable from inline error strings", () => {
    // The browser filters control frames by checking the leading '{'; inline
    // errors written by the route start with "\r\n" so they paint into xterm.
    expect(HEARTBEAT_PAYLOAD.startsWith("{")).toBe(true)
    expect(JSON.parse(HEARTBEAT_PAYLOAD)).toEqual({ type: "hb" })
  })
})

describe("shouldAutoKillSession", () => {
  // The bug this guards against: `zellij attach default` panics with EIO
  // (Input/output error, os error 5) on startup against a wedged session,
  // exits non-zero in well under a second, and the server-side session sticks
  // around. The next WS open hits the attach branch again → panics again →
  // user sees a black xterm forever. Detect the fast-crash and kill the
  // wedged session so the NEXT attach hits the create branch and rebuilds
  // it fresh with the project layout.
  it("kills when zellij attach exits non-zero within the fast-crash window", () => {
    expect(shouldAutoKillSession({ elapsedMs: 250, exitCode: 1, sessionName: "default" })).toBe(
      true,
    )
    expect(shouldAutoKillSession({ elapsedMs: 1500, exitCode: 134, sessionName: "default" })).toBe(
      true,
    )
  })

  it("never kills when the child exited cleanly — the user typed `exit`", () => {
    // A user who runs `exit` in their global terminal is detaching on purpose.
    // The session is healthy; killing it would lose their panes / scrollback.
    expect(shouldAutoKillSession({ elapsedMs: 200, exitCode: 0, sessionName: "default" })).toBe(
      false,
    )
  })

  it("never kills after a long-lived child exits — the session worked, then ended", () => {
    // Past the fast-crash window means the user actually used the terminal.
    // Auto-killing here would destroy real work on every detach.
    expect(
      shouldAutoKillSession({
        elapsedMs: FAST_CRASH_MS + 1,
        exitCode: 1,
        sessionName: "default",
      }),
    ).toBe(false)
  })

  it("returns false when sessionName is null — nothing to kill", () => {
    // Routes that couldn't resolve a session (invalid_id) skip the recovery.
    expect(shouldAutoKillSession({ elapsedMs: 100, exitCode: 1, sessionName: null })).toBe(false)
  })

  it("FAST_CRASH_MS is conservative enough to skip normal session use", () => {
    // The threshold must be longer than a panic-on-startup (sub-second) but
    // shorter than any plausible legitimate session — even a `claude attach`
    // that fails and falls back to bash takes well over 3s before the user
    // hits exit. Pin a sane order of magnitude.
    expect(FAST_CRASH_MS).toBeGreaterThanOrEqual(2_000)
    expect(FAST_CRASH_MS).toBeLessThanOrEqual(10_000)
  })
})

describe("zellijKillSessionArgv", () => {
  it("builds `zellij kill-session <name>` argv verbatim", () => {
    // The route uses Bun.spawn(argv) — no shell, so the session name does not
    // need quoting, but it must be passed as its own argv slot to survive
    // names with shell metacharacters (rare; sanitiser already restricts).
    expect(zellijKillSessionArgv("foo")).toEqual(["zellij", "kill-session", "foo"])
    expect(zellijKillSessionArgv("default")).toEqual(["zellij", "kill-session", "default"])
  })
})
