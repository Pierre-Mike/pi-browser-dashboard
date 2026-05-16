import { describe, expect, it } from "bun:test"
import { projectZellijCommand, zellijSessionName } from "./terminal.core"

describe("zellijSessionName", () => {
  it("prefixes pid- and lowercases", () => {
    expect(zellijSessionName("My-Repo")).toBe("pid-my-repo")
  })

  it("returns null for empty / whitespace-only input", () => {
    expect(zellijSessionName("")).toBe(null)
    expect(zellijSessionName("   ")).toBe(null)
    expect(zellijSessionName("///")).toBe(null)
  })

  it("collapses runs of unsafe chars into single dashes", () => {
    expect(zellijSessionName("foo bar / baz")).toBe("pid-foo-bar-baz")
    expect(zellijSessionName("a$$b##c")).toBe("pid-a-b-c")
  })

  it("preserves dots and underscores", () => {
    expect(zellijSessionName("foo.bar_baz")).toBe("pid-foo.bar_baz")
  })

  it("strips leading and trailing separators", () => {
    expect(zellijSessionName("--foo--")).toBe("pid-foo")
    expect(zellijSessionName("..foo..")).toBe("pid-foo")
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
    const cmd = projectZellijCommand({ cwd: "/path/to/repo", sessionName: "pid-foo" })
    expect(cmd.split("\n")[0]).toBe("cd '/path/to/repo'")
  })

  it("attaches when the session already exists", () => {
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "pid-foo" })
    expect(cmd).toContain("zellij list-sessions -s")
    expect(cmd).toContain("grep -qx 'pid-foo'")
    expect(cmd).toContain("exec zellij attach 'pid-foo'")
  })

  it("spawns a new session with a claude pane otherwise", () => {
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "pid-foo" })
    expect(cmd).toContain("exec zellij -s 'pid-foo' --layout-string")
    expect(cmd).toContain('command="claude"')
  })

  it("uses exec so the bash wrapper is replaced (close → detach, not kill)", () => {
    const cmd = projectZellijCommand({ cwd: "/x", sessionName: "pid-foo" })
    const attachLines = cmd.split("\n").filter((l) => l.includes("zellij"))
    for (const l of attachLines) {
      expect(l.trim().startsWith("exec ") || l.includes("list-sessions")).toBe(true)
    }
  })

  it("single-quote-escapes cwds containing apostrophes", () => {
    const cmd = projectZellijCommand({ cwd: "/it's/here", sessionName: "pid-x" })
    // POSIX trick: ' → '\''  (close, escaped-quote, reopen)
    expect(cmd).toContain(`cd '/it'\\''s/here'`)
  })
})
