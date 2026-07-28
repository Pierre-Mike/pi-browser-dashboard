import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { FleetView, type FleetViewProps } from "./FleetView"
import { renderWithRouter } from "./renderWithRouter"
import type { FleetsResponse, FleetWire, RunAttemptResult, RunSummaryWire } from "./types"

const fleet = (over: Partial<FleetWire> = {}): FleetWire => ({
  name: "review-and-fix",
  description: "three reviewers, then one fixer",
  steps: [
    {
      id: "review",
      intent: "review the diff",
      n: 3,
      agent: undefined,
      cwd: undefined,
      needs: [],
      until: undefined,
      timeoutMs: undefined,
    },
    {
      id: "fix",
      intent: "fix findings",
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

const baseProps = (over: Partial<FleetViewProps> = {}): FleetViewProps => ({
  projectName: "pi-browser-dashboard",
  loading: false,
  error: undefined,
  data: { fleets: [fleet()], errors: [] },
  runs: [],
  results: {},
  confirmFleet: null,
  isDryRunPending: () => false,
  isRunPending: () => false,
  confirmPending: false,
  onDryRun: () => {},
  onRequestRun: () => {},
  onConfirmRun: () => {},
  onCancelRun: () => {},
  ...over,
})

// FleetRunView (rendered for each run) links a spawned short via <Link>, which
// needs a router context — see renderWithRouter.ts.
const render = (props: FleetViewProps): Promise<string> =>
  renderWithRouter(() => createElement(FleetView, props))

describe("FleetView — loading/error/empty", () => {
  test("loading state", async () => {
    const html = await render(baseProps({ loading: true, data: undefined }))
    expect(html).toContain("Loading fleets")
    expect(html).not.toContain('data-testid="fleet-card"')
  })

  test("error state", async () => {
    const html = await render(baseProps({ error: "HTTP 500", data: undefined }))
    expect(html).toContain("HTTP 500")
  })

  test("empty state when there are no fleets and no errors", async () => {
    const html = await render(baseProps({ data: { fleets: [], errors: [] } }))
    expect(html).toContain('data-testid="fleet-empty"')
  })
})

describe("FleetView — invalid recipe hides Run entirely", () => {
  const invalid: FleetsResponse = {
    fleets: [],
    errors: [
      { fleet: "bad", step: "a", message: 'duplicate step id: "a"' },
      { fleet: "bad", step: "a", message: 'needs unknown step: "ghost"' },
    ],
  }

  test("shows every validation error", async () => {
    const html = await render(baseProps({ data: invalid }))
    expect(html).toContain('data-testid="fleet-recipe-errors"')
    // React escapes quotes in text content to HTML entities.
    expect(html).toContain("duplicate step id: &quot;a&quot;")
    expect(html).toContain("needs unknown step: &quot;ghost&quot;")
  })

  test("offers no Run (or Dry run) action at all — there is no valid fleet to run", async () => {
    const html = await render(baseProps({ data: invalid }))
    expect(html).not.toContain('data-testid="fleet-run"')
    expect(html).not.toContain('data-testid="fleet-dry-run"')
    expect(html).not.toContain('data-testid="fleet-card"')
  })
})

describe("FleetView — a valid fleet card", () => {
  test("shows its name, description, waves and totals", async () => {
    const html = await render(baseProps())
    expect(html).toContain('data-testid="fleet-card-name"')
    expect(html).toContain("review-and-fix")
    expect(html).toContain("three reviewers, then one fixer")
    expect(html).toContain("4 sessions")
    expect(html).toContain("2 waves")
    expect(html).toContain("wave 1")
    expect(html).toContain("wave 2")
  })

  test("Dry run and Run are both offered, and Run is not gated by anything but a click", async () => {
    const html = await render(baseProps())
    expect(html).toContain('data-testid="fleet-dry-run"')
    expect(html).toContain('data-testid="fleet-run"')
    // Clicking Run must only ever open the confirm dialog, never spawn
    // directly — the dialog is absent until the caller sets confirmFleet.
    expect(html).not.toContain('data-testid="fleet-confirm-run"')
  })

  test("Run is disabled while a run is already active for this fleet, and points at it", async () => {
    const activeRun: RunSummaryWire = {
      id: "run-1",
      projectId: "proj-1",
      fleet: "review-and-fix",
      status: "running",
      totalSessions: 4,
      startedAt: Date.now(),
      finishedAt: undefined,
      steps: [],
    }
    const html = await render(baseProps({ runs: [activeRun] }))
    const runButtonTag = html.slice(
      html.indexOf('data-testid="fleet-run"') - 200,
      html.indexOf('data-testid="fleet-run"') + 100,
    )
    expect(runButtonTag).toContain("disabled")
    expect(html).toContain('data-testid="fleet-active-run-link"')
    expect(html).toContain('href="#fleet-run-run-1"')
  })
})

describe("FleetView — the dry-run path renders a plan", () => {
  test("a DryRun result shows the plan's waves, per-step n and total", async () => {
    const results: Record<string, RunAttemptResult> = {
      "review-and-fix": {
        _tag: "DryRun",
        plan: {
          fleet: "review-and-fix",
          waves: [
            [
              {
                id: "review",
                intent: "review the diff",
                n: 3,
                agent: undefined,
                cwd: undefined,
                needs: [],
                until: undefined,
                timeoutMs: undefined,
              },
            ],
            [
              {
                id: "fix",
                intent: "fix findings",
                n: 1,
                agent: undefined,
                cwd: undefined,
                needs: ["review"],
                until: undefined,
                timeoutMs: undefined,
              },
            ],
          ],
          totalSessions: 4,
          maxConcurrentSpawns: 5,
        },
      },
    }
    const html = await render(baseProps({ results }))
    expect(html).toContain('data-testid="fleet-dry-run-plan"')
    expect(html).toContain("Plan: 4 sessions across 2 waves")
    expect(html).toContain("max 5 concurrent")
    expect(html).toContain("review×3")
    expect(html).toContain("fix×1")
  })

  test("a cap-exceeded result explains the violation instead of a plan", async () => {
    const results: Record<string, RunAttemptResult> = {
      "review-and-fix": { _tag: "CapExceeded", requested: 90, max: 50 },
    }
    const html = await render(baseProps({ results }))
    expect(html).toContain('data-testid="fleet-run-error"')
    expect(html).toContain("90")
    expect(html).toContain("50")
    expect(html).not.toContain('data-testid="fleet-dry-run-plan"')
  })
})

describe("FleetView — Run is gated behind an explicit confirm", () => {
  test("no confirm dialog renders until a fleet is set for confirmation", async () => {
    const html = await render(baseProps({ confirmFleet: null }))
    expect(html).not.toContain('data-testid="fleet-confirm-run"')
  })

  test("the confirm dialog states the exact cost: sessions, waves, project", async () => {
    const html = await render(baseProps({ confirmFleet: fleet() }))
    expect(html).toContain('data-testid="fleet-confirm-run"')
    expect(html).toContain('data-testid="fleet-confirm-copy"')
    expect(html).toContain("4 agent sessions")
    expect(html).toContain("2 waves")
    // React escapes quotes in text content to HTML entities.
    expect(html).toContain("&quot;pi-browser-dashboard&quot;")
    expect(html).toContain('data-testid="fleet-confirm-cancel"')
    expect(html).toContain('data-testid="fleet-confirm-start"')
    expect(html).toContain("Start 4 sessions")
  })

  test("the confirm button shows a spinner while the run is pending", async () => {
    const html = await render(baseProps({ confirmFleet: fleet(), confirmPending: true }))
    expect(html).toContain("loading-spinner")
    expect(html).not.toContain("Start 4 sessions")
  })
})

describe("FleetView — recent runs", () => {
  test("renders one FleetRunView per run, most-recent-first order is the caller's job", async () => {
    const runs: RunSummaryWire[] = [
      {
        id: "run-1",
        projectId: "proj-1",
        fleet: "review-and-fix",
        status: "done",
        totalSessions: 4,
        startedAt: Date.now() - 10_000,
        finishedAt: Date.now(),
        steps: [],
      },
    ]
    const html = await render(baseProps({ runs }))
    expect(html).toContain('data-testid="fleet-run-card"')
    expect(html).toContain('id="fleet-run-run-1"')
  })

  test("no 'Recent runs' section when there are none", async () => {
    const html = await render(baseProps({ runs: [] }))
    expect(html).not.toContain("Recent runs")
  })
})
