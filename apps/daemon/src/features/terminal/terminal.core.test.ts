import { describe, expect, it } from "bun:test"
import { cleanZellijEnv, projectZellijCommand, zellijSessionName } from "./terminal.core"

describe("zellijSessionName", () => {
  it("returns the bare repo name, lowercased — no prefix so we share the user's session", () => {
    expect(zellijSessionName("pi-browser-dashboard")).toBe("pi-browser-dashboard")
    expect(zellijSessionName("My-Repo")).toBe("my-repo")
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

  it("spawns a new session with a claude pane otherwise", () => {
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "foo" })
    expect(cmd).toContain("exec zellij -s 'foo' --layout-string")
    expect(cmd).toContain('command="claude"')
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
