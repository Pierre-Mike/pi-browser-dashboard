import { describe, expect, it } from "bun:test"
import type { Project, SessionState } from "../../lib/types"
import {
  activeProjectId,
  bucketProjects,
  growLimit,
  SESSION_PAGE_SIZE,
  sessionLabel,
  sessionMoreLabel,
  sessionWindow,
} from "./sidebarUtil"

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

  it("sorts sessions inside a bucket by updatedAt desc (recent first)", () => {
    const out = bucketProjects({
      projects: [proj()],
      sessions: [
        sess({ short: "old", updatedAt: "2026-06-01T10:00:00Z" }),
        sess({ short: "new", updatedAt: "2026-06-09T10:00:00Z" }),
        sess({ short: "mid", updatedAt: "2026-06-05T10:00:00Z" }),
      ],
    })
    expect(out[0]?.sessions.map((s) => s.short)).toEqual(["new", "mid", "old"])
  })

  it("sinks sessions with unparseable updatedAt below dated ones, keeping input order", () => {
    const out = bucketProjects({
      projects: [proj()],
      sessions: [
        sess({ short: "blank-a", updatedAt: "" }),
        sess({ short: "dated", updatedAt: "2026-06-09T10:00:00Z" }),
        sess({ short: "blank-b", updatedAt: "" }),
      ],
    })
    expect(out[0]?.sessions.map((s) => s.short)).toEqual(["dated", "blank-a", "blank-b"])
  })
})

describe("activeProjectId", () => {
  it("extracts the project id from a /projects/$id pathname", () => {
    expect(activeProjectId("/projects/p1")).toBe("p1")
  })

  it("returns null on non-project routes (session page must not match)", () => {
    expect(activeProjectId("/sessions/abc")).toBeNull()
    expect(activeProjectId("/")).toBeNull()
    expect(activeProjectId("/projects/")).toBeNull()
  })

  it("decodes URL-encoded ids and tolerates a trailing slash", () => {
    expect(activeProjectId("/projects/my%20app")).toBe("my app")
    expect(activeProjectId("/projects/p1/")).toBe("p1")
  })
})

describe("sessionWindow", () => {
  const seven = Array.from({ length: 7 }, (_, i) => sess({ short: `s${i}` }))

  it("shows only the first page and counts the rest as hidden", () => {
    const out = sessionWindow({ sessions: seven, limit: SESSION_PAGE_SIZE })
    expect(out.visible.map((s) => s.short)).toEqual(["s0", "s1", "s2", "s3", "s4"])
    expect(out.hiddenCount).toBe(2)
  })

  it("shows everything once the limit covers the whole list", () => {
    const out = sessionWindow({ sessions: seven, limit: 10 })
    expect(out.visible).toHaveLength(7)
    expect(out.hiddenCount).toBe(0)
  })
})

describe("growLimit", () => {
  it("reveals one more page per click", () => {
    expect(growLimit(SESSION_PAGE_SIZE)).toBe(10)
    expect(growLimit(growLimit(SESSION_PAGE_SIZE))).toBe(15)
  })
})

describe("sessionMoreLabel", () => {
  it("offers a full page and reports the hidden total", () => {
    expect(sessionMoreLabel(12)).toBe("Show 5 more (12 hidden)")
  })

  it("offers only the remainder when fewer than a page is hidden", () => {
    expect(sessionMoreLabel(2)).toBe("Show 2 more")
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
