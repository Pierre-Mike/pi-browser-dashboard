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
    const out = bucketProjects({
      projects: [proj()],
      sessions: [sess({ short: "s1" }), sess({ short: "s2" })],
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.project?.id).toBe("p1")
    expect(out[0]?.sessions.map((s) => s.short)).toEqual(["s1", "s2"])
  })

  it("buckets unknown-cwd sessions under cwd-tail title", () => {
    const out = bucketProjects({ projects: [], sessions: [sess({ cwd: "/x/y/orphan" })] })
    expect(out).toHaveLength(1)
    expect(out[0]?.project).toBeNull()
    expect(out[0]?.title).toBe("y/orphan")
  })

  it("keeps the bare project name (no warn prefix) for non-git projects", () => {
    const out = bucketProjects({
      projects: [proj({ isGitRepo: false, name: "no-git" })],
      sessions: [],
    })
    expect(out[0]?.title).toBe("no-git")
  })

  it("sorts by session count desc, then title asc", () => {
    const a = proj({ id: "a", name: "a-empty", path: "/p/a" })
    const b = proj({ id: "b", name: "b-busy", path: "/p/b" })
    const c = proj({ id: "c", name: "c-empty", path: "/p/c" })
    const out = bucketProjects({
      projects: [a, b, c],
      sessions: [sess({ cwd: "/p/b", short: "s1" }), sess({ cwd: "/p/b", short: "s2" })],
    })
    expect(out.map((bk) => bk.title)).toEqual(["b-busy", "a-empty", "c-empty"])
  })

  it("floats pinned projects above unpinned ones regardless of session count", () => {
    const a = proj({ id: "a", name: "a-busy", path: "/p/a" })
    const b = proj({ id: "b", name: "b-busy", path: "/p/b" })
    const c = proj({ id: "c", name: "c-pinned", path: "/p/c" })
    const out = bucketProjects({
      projects: [a, b, c],
      sessions: [
        sess({ cwd: "/p/a", short: "s1" }),
        sess({ cwd: "/p/a", short: "s2" }),
        sess({ cwd: "/p/b", short: "s3" }),
        sess({ cwd: "/p/c", short: "s4" }),
      ],
      pinnedIds: new Set(["c"]),
    })
    expect(out.map((bk) => bk.title)).toEqual(["c-pinned", "a-busy", "b-busy"])
    expect(out[0]?.pinned).toBe(true)
    expect(out[1]?.pinned).toBe(false)
  })

  it("pins projects even when they have no sessions", () => {
    const a = proj({ id: "a", name: "a-empty", path: "/p/a" })
    const b = proj({ id: "b", name: "b-busy", path: "/p/b" })
    const out = bucketProjects({
      projects: [a, b],
      sessions: [sess({ cwd: "/p/b" })],
      pinnedIds: new Set(["a"]),
    })
    expect(out.map((bk) => bk.title)).toEqual(["a-empty", "b-busy"])
    expect(out[0]?.pinned).toBe(true)
    expect(out[1]?.pinned).toBe(false)
  })

  it("does not pin orphan (project-less) buckets even if id matches", () => {
    const out = bucketProjects({
      projects: [],
      sessions: [sess({ cwd: "/x/y/orphan" })],
      pinnedIds: new Set(["/x/y/orphan"]),
    })
    expect(out[0]?.pinned).toBe(false)
  })

  it("defaults pinned to false when no set is passed", () => {
    const out = bucketProjects({ projects: [proj()], sessions: [sess()] })
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
