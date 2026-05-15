import { describe, expect, it } from "bun:test"
import { looksBinary, resolveProjectPath, sortEntries } from "./projects.core"

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
