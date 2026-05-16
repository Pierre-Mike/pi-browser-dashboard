import { describe, expect, it } from "bun:test"
import { projectZellijCommand, zellijSessionName } from "./terminal.core"

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
