import { describe, expect, it, test } from "bun:test"
import {
  looksBinary,
  parseGithubOrigin,
  parseGithubUrl,
  resolveProjectPath,
  sortEntries,
} from "./projects.core"

const ROOT = "/repos/demo"

describe("resolveProjectPath", () => {
  it("treats empty input as the project root", () => {
    const r = resolveProjectPath(ROOT, "")
    expect(r).toEqual({ ok: true, absPath: ROOT, relPath: "" })
  })

  it("treats undefined input as the project root", () => {
    const r = resolveProjectPath(ROOT, undefined)
    expect(r).toEqual({ ok: true, absPath: ROOT, relPath: "" })
  })

  it("resolves a simple relative path inside the root", () => {
    const r = resolveProjectPath(ROOT, "src/index.ts")
    expect(r).toEqual({ ok: true, absPath: "/repos/demo/src/index.ts", relPath: "src/index.ts" })
  })

  it("normalizes redundant segments", () => {
    const r = resolveProjectPath(ROOT, "./src/./lib/")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.relPath).toBe("src/lib")
  })

  it("rejects parent-directory escapes", () => {
    expect(resolveProjectPath(ROOT, "../secrets")).toEqual({ ok: false, reason: "escape" })
    expect(resolveProjectPath(ROOT, "src/../../secrets")).toEqual({ ok: false, reason: "escape" })
  })

  it("rejects absolute paths", () => {
    expect(resolveProjectPath(ROOT, "/etc/passwd")).toEqual({ ok: false, reason: "absolute" })
  })

  it("rejects NUL bytes", () => {
    expect(resolveProjectPath(ROOT, "src/\0bad")).toEqual({ ok: false, reason: "invalid" })
  })
})

describe("looksBinary", () => {
  it("flags buffers containing a NUL byte", () => {
    expect(looksBinary(new Uint8Array([72, 105, 0, 33]))).toBe(true)
  })
  it("treats clean ASCII as text", () => {
    const text = new TextEncoder().encode("hello, world\n")
    expect(looksBinary(text)).toBe(false)
  })
  it("treats empty buffer as text", () => {
    expect(looksBinary(new Uint8Array())).toBe(false)
  })
})

describe("sortEntries", () => {
  it("orders directories before files, then alphabetically", () => {
    const out = sortEntries([
      { name: "z.ts", type: "file", size: 1 },
      { name: "b.ts", type: "file", size: 1 },
      { name: "src", type: "dir", size: 0 },
      { name: "apps", type: "dir", size: 0 },
    ])
    expect(out.map((e) => e.name)).toEqual(["apps", "src", "b.ts", "z.ts"])
  })
})

describe("parseGithubUrl", () => {
  test("parses SSH origin", () => {
    expect(parseGithubUrl("git@github.com:acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    })
  })

  test("parses SSH origin without .git suffix", () => {
    expect(parseGithubUrl("git@github.com:acme/widgets")).toEqual({
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    })
  })

  test("parses HTTPS origin", () => {
    expect(parseGithubUrl("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    })
  })

  test("parses HTTPS origin with token prefix", () => {
    expect(parseGithubUrl("https://x-access-token:abc123@github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    })
  })

  test("parses ssh:// scheme", () => {
    expect(parseGithubUrl("ssh://git@github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    })
  })

  test("returns null for non-github host", () => {
    expect(parseGithubUrl("git@gitlab.com:acme/widgets.git")).toBeNull()
    expect(parseGithubUrl("https://gitlab.com/acme/widgets.git")).toBeNull()
  })

  test("returns null for malformed url", () => {
    expect(parseGithubUrl("not-a-url")).toBeNull()
    expect(parseGithubUrl("")).toBeNull()
  })
})

describe("parseGithubOrigin", () => {
  test("extracts origin URL from a .git/config", () => {
    const cfg = `[core]
\trepositoryformatversion = 0
\tfilemode = true
[remote "origin"]
\turl = git@github.com:Pierre-Mike/pi-browser-dashboard.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
\tmerge = refs/heads/main
`
    expect(parseGithubOrigin(cfg)).toEqual({
      owner: "Pierre-Mike",
      repo: "pi-browser-dashboard",
      url: "https://github.com/Pierre-Mike/pi-browser-dashboard",
    })
  })

  test("ignores upstream remote when origin is non-github", () => {
    const cfg = `[remote "origin"]
\turl = git@gitlab.com:acme/widgets.git
[remote "upstream"]
\turl = git@github.com:acme/widgets.git
`
    expect(parseGithubOrigin(cfg)).toBeNull()
  })

  test("returns null when origin remote is absent", () => {
    const cfg = `[core]
\trepositoryformatversion = 0
`
    expect(parseGithubOrigin(cfg)).toBeNull()
  })

  test("skips comments and blank lines", () => {
    const cfg = `# top-level comment
[remote "origin"]
; inline comment
\turl = https://github.com/acme/widgets
`
    expect(parseGithubOrigin(cfg)).toEqual({
      owner: "acme",
      repo: "widgets",
      url: "https://github.com/acme/widgets",
    })
  })
})
