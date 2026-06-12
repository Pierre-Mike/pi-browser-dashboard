import { describe, expect, it, test } from "bun:test"
import {
  compareProjectsByCommit,
  contentDispositionAttachment,
  isSkippedTreeDir,
  looksBinary,
  MAX_TREE_FILES,
  mimeFromPath,
  parseGitCommitTimestamp,
  parseGitHead,
  parseGithubOrigin,
  parseGithubUrl,
  resolveProjectPath,
  sortEntries,
} from "./projects.core"

const ROOT = "/repos/demo"

describe("contentDispositionAttachment", () => {
  it("forces attachment and preserves the basename for an ASCII name", () => {
    expect(contentDispositionAttachment("notes/report.pdf")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    )
  })

  it("strips directory segments so only the filename is offered", () => {
    expect(contentDispositionAttachment("a/b/c/data.json")).toBe(
      `attachment; filename="data.json"; filename*=UTF-8''data.json`,
    )
  })

  it("sanitises quotes and backslashes in the ASCII fallback", () => {
    expect(contentDispositionAttachment(`weird"name\\.txt`)).toBe(
      `attachment; filename="weird_name_.txt"; filename*=UTF-8''weird%22name%5C.txt`,
    )
  })

  it("encodes non-ASCII names via RFC 5987 while keeping an ASCII fallback", () => {
    expect(contentDispositionAttachment("café.txt")).toBe(
      `attachment; filename="caf_.txt"; filename*=UTF-8''caf%C3%A9.txt`,
    )
  })

  it("falls back to 'download' when no basename is present", () => {
    expect(contentDispositionAttachment("")).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    )
  })
})

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

describe("parseGitCommitTimestamp", () => {
  test("parses a unix-seconds timestamp to milliseconds", () => {
    expect(parseGitCommitTimestamp("1715000000\n")).toBe(1_715_000_000_000)
  })

  test("tolerates surrounding whitespace", () => {
    expect(parseGitCommitTimestamp("  1715000000  ")).toBe(1_715_000_000_000)
  })

  test("returns null for empty or non-numeric input", () => {
    expect(parseGitCommitTimestamp("")).toBeNull()
    expect(parseGitCommitTimestamp("\n")).toBeNull()
    expect(parseGitCommitTimestamp("not-a-number")).toBeNull()
  })

  test("returns null for negative or non-integer values", () => {
    expect(parseGitCommitTimestamp("-1")).toBeNull()
    expect(parseGitCommitTimestamp("1.5")).toBeNull()
  })
})

describe("compareProjectsByCommit", () => {
  const base = { id: "x", name: "x", path: "/x", isGitRepo: false } as const

  test("orders by lastCommitMs descending when both are present", () => {
    const a = { ...base, id: "a", lastModified: 1, lastCommitMs: 100 }
    const b = { ...base, id: "b", lastModified: 1, lastCommitMs: 200 }
    expect(compareProjectsByCommit(a, b)).toBeGreaterThan(0)
    expect(compareProjectsByCommit(b, a)).toBeLessThan(0)
  })

  test("falls back to lastModified when lastCommitMs is missing", () => {
    const a = { ...base, id: "a", lastModified: 50 }
    const b = { ...base, id: "b", lastModified: 10, lastCommitMs: 100 }
    // a uses 50 (mtime), b uses 100 (commit) → b first
    expect(compareProjectsByCommit(a, b)).toBeGreaterThan(0)
  })

  test("ranks commit time above mtime when mixed", () => {
    const gitRecent = { ...base, id: "git", lastModified: 1, lastCommitMs: 1000 }
    const mtimeAhead = { ...base, id: "plain", lastModified: 999 }
    const sorted = [mtimeAhead, gitRecent].sort(compareProjectsByCommit)
    expect(sorted.map((p) => p.id)).toEqual(["git", "plain"])
  })
})

describe("parseGitHead", () => {
  test("returns the branch name from a symbolic ref", () => {
    expect(parseGitHead("ref: refs/heads/main\n")).toBe("main")
  })

  test("returns slash-containing branch names verbatim", () => {
    expect(parseGitHead("ref: refs/heads/feat/login\n")).toBe("feat/login")
  })

  test("tolerates missing trailing newline and extra whitespace", () => {
    expect(parseGitHead("  ref: refs/heads/main  ")).toBe("main")
  })

  test("returns null for a detached HEAD (raw SHA)", () => {
    expect(parseGitHead("9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b\n")).toBeNull()
  })

  test("returns null for a ref that is not under refs/heads/", () => {
    expect(parseGitHead("ref: refs/tags/v1.0\n")).toBeNull()
  })

  test("returns null for empty or whitespace-only input", () => {
    expect(parseGitHead("")).toBeNull()
    expect(parseGitHead("   \n")).toBeNull()
  })
})

describe("mimeFromPath", () => {
  test("maps image extensions", () => {
    expect(mimeFromPath("logo.png")).toBe("image/png")
    expect(mimeFromPath("Photo.JPG")).toBe("image/jpeg")
    expect(mimeFromPath("icon.svg")).toBe("image/svg+xml")
    expect(mimeFromPath("frame.webp")).toBe("image/webp")
  })

  test("maps audio extensions", () => {
    expect(mimeFromPath("clip.mp3")).toBe("audio/mpeg")
    expect(mimeFromPath("song.WAV")).toBe("audio/wav")
    expect(mimeFromPath("voice.ogg")).toBe("audio/ogg")
  })

  test("maps video extensions", () => {
    expect(mimeFromPath("scene.mp4")).toBe("video/mp4")
    expect(mimeFromPath("clip.webm")).toBe("video/webm")
    expect(mimeFromPath("intro.mov")).toBe("video/quicktime")
  })

  test("maps document and text extensions", () => {
    expect(mimeFromPath("manual.pdf")).toBe("application/pdf")
    expect(mimeFromPath("README.md")).toBe("text/markdown; charset=utf-8")
    expect(mimeFromPath("page.html")).toBe("text/html; charset=utf-8")
    expect(mimeFromPath("notes.txt")).toBe("text/plain; charset=utf-8")
    expect(mimeFromPath("data.json")).toBe("application/json; charset=utf-8")
  })

  test("falls back to octet-stream for unknown and extensionless paths", () => {
    expect(mimeFromPath("Dockerfile")).toBe("application/octet-stream")
    expect(mimeFromPath("archive.xyz")).toBe("application/octet-stream")
    expect(mimeFromPath("nodot")).toBe("application/octet-stream")
    expect(mimeFromPath("trailing.")).toBe("application/octet-stream")
  })
})

describe("tree listing guards", () => {
  test("skips VCS metadata and dependency/build dirs", () => {
    expect(isSkippedTreeDir(".git")).toBe(true)
    expect(isSkippedTreeDir("node_modules")).toBe(true)
    expect(isSkippedTreeDir("dist")).toBe(true)
  })

  test("keeps ordinary source directories", () => {
    expect(isSkippedTreeDir("src")).toBe(false)
    expect(isSkippedTreeDir("features")).toBe(false)
    expect(isSkippedTreeDir(".github")).toBe(false)
  })

  test("caps the recursive listing well above a normal repo but below pathological sizes", () => {
    expect(MAX_TREE_FILES).toBeGreaterThanOrEqual(10_000)
    expect(MAX_TREE_FILES).toBeLessThanOrEqual(100_000)
  })
})
