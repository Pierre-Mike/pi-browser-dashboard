import { describe, expect, test } from "bun:test"
import {
  confirmRunCopy,
  relativeAge,
  runStatusLabel,
  runStatusTone,
  stepProgress,
  stepStatusLabel,
  stepStatusTone,
  totalSessionsOf,
  waveCountOf,
} from "./fleetFormat"
import type { FleetWire, RunSummaryWire } from "./types"

const fleet = (over: Partial<FleetWire> = {}): FleetWire => ({
  name: "review-and-fix",
  description: undefined,
  steps: [
    {
      id: "review",
      intent: "review",
      n: 3,
      agent: undefined,
      cwd: undefined,
      needs: [],
      until: undefined,
      timeoutMs: undefined,
    },
    {
      id: "fix",
      intent: "fix",
      n: 1,
      agent: undefined,
      cwd: undefined,
      needs: ["review"],
      until: undefined,
      timeoutMs: undefined,
    },
  ],
  waves: [["review"], ["fix"]],
  ...over,
})

describe("totalSessionsOf / waveCountOf", () => {
  test("sums every step's n", () => {
    expect(totalSessionsOf(fleet())).toBe(4)
  })

  test("counts waves", () => {
    expect(waveCountOf(fleet())).toBe(2)
  })

  test("a fleet with no steps has zero total sessions", () => {
    expect(totalSessionsOf(fleet({ steps: [] }))).toBe(0)
  })
})

describe("confirmRunCopy", () => {
  test("states the exact cost: sessions, waves, and the project", () => {
    const copy = confirmRunCopy({
      fleetName: "review-and-fix",
      projectName: "pi-browser-dashboard",
      totalSessions: 4,
      waveCount: 2,
    })
    expect(copy).toContain("4 agent sessions")
    expect(copy).toContain("2 waves")
    expect(copy).toContain('"pi-browser-dashboard"')
    expect(copy).toContain('"review-and-fix"')
  })

  test("singularizes a count of one", () => {
    const copy = confirmRunCopy({
      fleetName: "solo",
      projectName: "demo",
      totalSessions: 1,
      waveCount: 1,
    })
    expect(copy).toContain("1 agent session ")
    expect(copy).toContain("1 wave ")
    expect(copy).not.toContain("1 agent sessions")
    expect(copy).not.toContain("1 waves")
  })
})

describe("step/run status tone and label", () => {
  test("skipped and failed read as visually distinct tones", () => {
    const skipped = stepStatusTone("skipped")
    const failed = stepStatusTone("failed")
    expect(skipped.bg).not.toBe(failed.bg)
    expect(skipped.text).not.toBe(failed.text)
  })

  test("skipped is muted (neutral), not alarming like failed", () => {
    expect(stepStatusTone("skipped").text).toContain("base-content")
    expect(stepStatusTone("failed").text).toContain("error")
  })

  test("labels read as sentence case, not the raw status slug", () => {
    expect(stepStatusLabel("skipped")).toBe("Skipped")
    expect(stepStatusLabel("failed")).toBe("Failed")
    expect(runStatusLabel("running")).toBe("Running")
  })

  test("a running run's tone matches an in-progress step's tone", () => {
    expect(runStatusTone("running")).toEqual(stepStatusTone("spawning"))
  })
})

describe("stepProgress", () => {
  test("counts done steps against the total", () => {
    const run: RunSummaryWire = {
      id: "run-1",
      projectId: "proj-1",
      fleet: "review-and-fix",
      status: "running",
      totalSessions: 2,
      startedAt: 0,
      finishedAt: undefined,
      steps: [
        {
          stepId: "a",
          waveIndex: 0,
          intent: "x",
          n: 1,
          status: "done",
          shorts: [],
          reason: undefined,
        },
        {
          stepId: "b",
          waveIndex: 1,
          intent: "y",
          n: 1,
          status: "pending",
          shorts: [],
          reason: undefined,
        },
      ],
    }
    expect(stepProgress(run)).toEqual({ done: 1, total: 2 })
  })
})

describe("relativeAge", () => {
  test("buckets seconds, minutes, hours and days", () => {
    const now = Date.now()
    expect(relativeAge(now)).toMatch(/^\d+s$/)
    expect(relativeAge(now - 90_000)).toBe("1m")
    expect(relativeAge(now - 2 * 3_600_000)).toBe("2h")
    expect(relativeAge(now - 3 * 86_400_000)).toBe("3d")
  })

  test("clamps a future timestamp to zero rather than going negative", () => {
    expect(relativeAge(Date.now() + 60_000)).toBe("0s")
  })
})
