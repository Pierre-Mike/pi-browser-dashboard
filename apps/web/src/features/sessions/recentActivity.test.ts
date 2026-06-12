import { describe, expect, it } from "bun:test"
import type { Project, SessionState } from "../../lib/types"
import { RECENT_LIMIT, recentSessions } from "./recentActivity"

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

describe("recentSessions", () => {
  it("orders sessions by updatedAt, newest first", () => {
    const items = recentSessions({
      projects: [],
      sessions: [
        sess({ short: "old", updatedAt: "2026-06-01T00:00:00Z" }),
        sess({ short: "new", updatedAt: "2026-06-12T00:00:00Z" }),
        sess({ short: "mid", updatedAt: "2026-06-06T00:00:00Z" }),
      ],
    })
    expect(items.map((i) => i.session.short)).toEqual(["new", "mid", "old"])
  })

  it("caps the feed at the limit (default 10)", () => {
    const many = Array.from({ length: 25 }, (_, n) =>
      sess({
        short: `s${n}`,
        updatedAt: `2026-06-${String((n % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    )
    expect(recentSessions({ projects: [], sessions: many })).toHaveLength(RECENT_LIMIT)
    expect(recentSessions({ projects: [], sessions: many, limit: 3 })).toHaveLength(3)
  })

  it("labels each session with its owning project name", () => {
    const [item] = recentSessions({
      projects: [proj({ id: "p1", name: "alpha", path: "/home/u/alpha" })],
      sessions: [sess({ cwd: "/home/u/alpha", updatedAt: "2026-06-12T00:00:00Z" })],
    })
    expect(item?.project?.id).toBe("p1")
    expect(item?.projectName).toBe("alpha")
  })

  it("falls back to the cwd tail when no project owns the session", () => {
    const [item] = recentSessions({
      projects: [],
      sessions: [sess({ cwd: "/home/u/orphan-repo", updatedAt: "2026-06-12T00:00:00Z" })],
    })
    expect(item?.project).toBeNull()
    expect(item?.projectName).toBe("u/orphan-repo")
  })

  it("sinks sessions with unparseable timestamps to the bottom", () => {
    const items = recentSessions({
      projects: [],
      sessions: [
        sess({ short: "bad", updatedAt: "" }),
        sess({ short: "good", updatedAt: "2026-06-12T00:00:00Z" }),
      ],
    })
    expect(items.map((i) => i.session.short)).toEqual(["good", "bad"])
  })

  it("returns an empty feed when there are no sessions", () => {
    expect(recentSessions({ projects: [proj()], sessions: [] })).toEqual([])
  })
})
