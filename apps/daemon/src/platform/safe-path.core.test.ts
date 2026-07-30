import { describe, expect, it } from "bun:test"
import { isSafeSegment, resolveProjectPath, validateRelPath } from "./safe-path.core"

// Moved verbatim from projects.core.test.ts (resolveProjectPath, validateRelPath)
// and claude-config.core.test.ts (isSafeSegment) when the guards moved here. The
// assertions are unchanged: this is a relocation, not a rewrite.

const ROOT = "/repos/demo"

describe("resolveProjectPath", () => {
  it("treats empty input as the project root", () => {
    const r = resolveProjectPath({ root: ROOT, input: "" })
    expect(r).toEqual({ ok: true, absPath: ROOT, relPath: "" })
  })

  it("treats undefined input as the project root", () => {
    const r = resolveProjectPath({ root: ROOT, input: undefined })
    expect(r).toEqual({ ok: true, absPath: ROOT, relPath: "" })
  })

  it("resolves a simple relative path inside the root", () => {
    const r = resolveProjectPath({ root: ROOT, input: "src/index.ts" })
    expect(r).toEqual({ ok: true, absPath: "/repos/demo/src/index.ts", relPath: "src/index.ts" })
  })

  it("normalizes redundant segments", () => {
    const r = resolveProjectPath({ root: ROOT, input: "./src/./lib/" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.relPath).toBe("src/lib")
  })

  it("rejects parent-directory escapes", () => {
    expect(resolveProjectPath({ root: ROOT, input: "../secrets" })).toEqual({
      ok: false,
      reason: "escape",
    })
    expect(resolveProjectPath({ root: ROOT, input: "src/../../secrets" })).toEqual({
      ok: false,
      reason: "escape",
    })
  })

  it("rejects absolute paths", () => {
    expect(resolveProjectPath({ root: ROOT, input: "/etc/passwd" })).toEqual({
      ok: false,
      reason: "absolute",
    })
  })

  it("rejects NUL bytes", () => {
    expect(resolveProjectPath({ root: ROOT, input: "src/\0bad" })).toEqual({
      ok: false,
      reason: "invalid",
    })
  })
})

describe("validateRelPath", () => {
  it("accepts ordinary relative paths and the empty string", () => {
    expect(validateRelPath("")).toBe(true)
    expect(validateRelPath("index.html")).toBe(true)
    expect(validateRelPath("assets/app.js")).toBe(true)
  })

  it("rejects traversal, backslashes, and absolute paths", () => {
    expect(validateRelPath("../secret")).toBe(false)
    expect(validateRelPath("a/../b")).toBe(false)
    expect(validateRelPath("..%2f")).toBe(false) // single-decoded traversal still contains ".."
    expect(validateRelPath("a\\b")).toBe(false)
    expect(validateRelPath("/etc/passwd")).toBe(false)
  })
})

describe("isSafeSegment", () => {
  it("accepts normal ids", () => {
    expect(isSafeSegment("concise")).toBe(true)
    expect(isSafeSegment("claude-p")).toBe(true)
    expect(isSafeSegment("a.b.c")).toBe(true)
  })
  it("rejects dotfiles, slashes, NUL", () => {
    expect(isSafeSegment(".hidden")).toBe(false)
    expect(isSafeSegment("a/b")).toBe(false)
    expect(isSafeSegment("a\\b")).toBe(false)
    expect(isSafeSegment("a\0b")).toBe(false)
    expect(isSafeSegment("")).toBe(false)
  })
})
