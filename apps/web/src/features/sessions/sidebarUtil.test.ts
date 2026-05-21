import { describe, expect, it } from "bun:test"
import type { Project, SessionState } from "../../lib/types"
import { bucketProjects, sessionLabel } from "./sidebarUtil"

const proj = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "alpha",
  path: "/home/u/alpha",
  isGitRepo: true,
  lastModified: 0,
  ...over,
})

const sess = (over: Partial<SessionState> = {}): SessionState => ({
  short: "abc",
  state: "idle",
  detail: "",
  tempo: "",
  intent: "",
  name: "",
  sessionId: "",
  cwd: "/home/u/alpha",
  createdAt: "",
  updatedAt: "",
  linkScanPath: "",
  ...over,
})

describe("bucketProjects", () => {
  it("attaches sessions to projects by matching cwd", () => {
    const out = bucketProjects([proj()], [sess({ short: "s1" }), sess({ short: "s2" })])
    expect(out).toHaveLength(1)
    expect(out[0]?.project?.id).toBe("p1")
    expect(out[0]?.sessions.map((s) => s.short)).toEqual(["s1", "s2"])
  })

  it("buckets unknown-cwd sessions under cwd-tail title", () => {
    const out = bucketProjects([], [sess({ cwd: "/x/y/orphan" })])
    expect(out).toHaveLength(1)
    expect(out[0]?.project).toBeNull()
    expect(out[0]?.title).toBe("y/orphan")
  })

  it("keeps the bare project name (no warn prefix) for non-git projects", () => {
    const out = bucketProjects([proj({ isGitRepo: false, name: "no-git" })], [])
    expect(out[0]?.title).toBe("no-git")
  })

  it("sorts by session count desc, then title asc", () => {
    const a = proj({ id: "a", name: "a-empty", path: "/p/a" })
    const b = proj({ id: "b", name: "b-busy", path: "/p/b" })
    const c = proj({ id: "c", name: "c-empty", path: "/p/c" })
    const out = bucketProjects(
      [a, b, c],
      [sess({ cwd: "/p/b", short: "s1" }), sess({ cwd: "/p/b", short: "s2" })],
    )
    expect(out.map((bk) => bk.title)).toEqual(["b-busy", "a-empty", "c-empty"])
  })

  it("floats pinned projects with sessions above unpinned ones", () => {
    const a = proj({ id: "a", name: "a-busy", path: "/p/a" })
    const b = proj({ id: "b", name: "b-busy", path: "/p/b" })
    const c = proj({ id: "c", name: "c-pinned", path: "/p/c" })
    const out = bucketProjects(
      [a, b, c],
      [
        sess({ cwd: "/p/a", short: "s1" }),
        sess({ cwd: "/p/a", short: "s2" }),
        sess({ cwd: "/p/b", short: "s3" }),
        sess({ cwd: "/p/c", short: "s4" }),
      ],
      new Set(["c"]),
    )
    expect(out.map((bk) => bk.title)).toEqual(["c-pinned", "a-busy", "b-busy"])
    expect(out[0]?.pinned).toBe(true)
    expect(out[1]?.pinned).toBe(false)
  })

  it("ignores pin on projects without sessions", () => {
    const a = proj({ id: "a", name: "a-empty", path: "/p/a" })
    const b = proj({ id: "b", name: "b-busy", path: "/p/b" })
    const out = bucketProjects([a, b], [sess({ cwd: "/p/b" })], new Set(["a"]))
    expect(out.map((bk) => bk.title)).toEqual(["b-busy", "a-empty"])
    expect(out[1]?.pinned).toBe(false)
  })

  it("defaults pinned to false when no set is passed", () => {
    const out = bucketProjects([proj()], [sess()])
    expect(out[0]?.pinned).toBe(false)
  })
})

describe("sessionLabel", () => {
  it("returns the trimmed name when present", () => {
    expect(sessionLabel(sess({ name: "  feature-x  ", short: "abc" }))).toBe("feature-x")
  })
  it("falls back to short id when name is blank", () => {
    expect(sessionLabel(sess({ name: "   ", short: "abc" }))).toBe("abc")
  })
})
