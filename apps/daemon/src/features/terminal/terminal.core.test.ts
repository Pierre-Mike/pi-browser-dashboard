import { describe, expect, it } from "bun:test"
import {
  GLOBAL_ZELLIJ_SESSION,
  buildChildArgv,
  cleanZellijEnv,
  globalTerminalCwd,
  projectZellijCommand,
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

  it("creates a bare new session (no layout, no auto-claude) so the zellij tab bar is visible", () => {
    // Project sessions used to launch with a layout file that auto-ran
    // `claude` in the only pane — which swallowed the zellij UI: one pane,
    // no tab bar, indistinguishable from running `claude` directly. Bare
    // zellij gives the user the tab bar and their default shell so they
    // can run claude themselves (or anything else).
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    expect(cmd).toContain(`exec zellij -s 'foo'`)
    expect(cmd).not.toContain(" -n ")
    expect(cmd).not.toContain("--layout")
    expect(cmd).not.toContain("claude")
  })

  it("uses exec so the bash wrapper is replaced (close → detach, not kill)", () => {
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    const attachLines = cmd.split("\n").filter((l) => l.includes("zellij"))
    for (const l of attachLines) {
      expect(l.trim().startsWith("exec ") || l.includes("list-sessions")).toBe(true)
    }
  })

  it("single-quote-escapes cwds containing apostrophes", () => {
    const cmd = projectZellijCommand({ cwd: "/it's/here", sessionName: "x" })
    // POSIX trick: ' → '\''  (close, escaped-quote, reopen)
    expect(cmd).toContain(`cd '/it'\\''s/here'`)
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

  it("pty=true → python3 pty.spawn wrapper, cmd passed as argv[1]", () => {
    // BSD script(1) wants stdin to be a tty; we have a pipe. python3 pty.spawn
    // uses forkpty() so the pipe stays a pipe and the child still gets a pty.
    const argv = buildChildArgv({ cmd: "zellij attach foo", pty: true, platform: "darwin" })
    expect(argv[0]).toBe("python3")
    expect(argv[1]).toBe("-c")
    expect(argv[2]).toContain("pty.spawn")
    expect(argv[3]).toBe("zellij attach foo")
  })

  it("pty=true argv is platform-agnostic (same on darwin and linux)", () => {
    const darwin = buildChildArgv({ cmd: "x", pty: true, platform: "darwin" })
    const linux = buildChildArgv({ cmd: "x", pty: true, platform: "linux" })
    expect(darwin).toEqual(linux)
  })
})
