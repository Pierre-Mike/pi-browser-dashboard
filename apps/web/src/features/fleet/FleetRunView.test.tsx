import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { FleetRunView } from "./FleetRunView"
import { renderWithRouter } from "./renderWithRouter"
import type { RunSummaryWire, StepSummaryWire } from "./types"

const step = (over: Partial<StepSummaryWire> = {}): StepSummaryWire => ({
  stepId: "review",
  waveIndex: 0,
  intent: "review the working diff",
  n: 3,
  status: "spawning",
  shorts: [],
  reason: undefined,
  ...over,
})

const run = (over: Partial<RunSummaryWire> = {}): RunSummaryWire => ({
  id: "run-1",
  projectId: "proj-1",
  fleet: "review-and-fix",
  status: "running",
  totalSessions: 4,
  startedAt: Date.now() - 5_000,
  finishedAt: undefined,
  steps: [step()],
  ...over,
})

// FleetRunView links each spawned short to its session drill-in via <Link>,
// which needs a router context — see renderWithRouter.ts.
const render = (r: RunSummaryWire): Promise<string> =>
  renderWithRouter(() => createElement(FleetRunView, { run: r }))

describe("FleetRunView", () => {
  test("anchors the card by run id so the panel's active-run link can scroll to it", async () => {
    const html = await render(run())
    expect(html).toContain('id="fleet-run-run-1"')
    expect(html).toContain('data-testid="fleet-run-card"')
    expect(html).toContain('data-run-status="running"')
  })

  test("renders one step row per step, with its intent", async () => {
    const html = await render(
      run({
        steps: [
          step({ stepId: "review", intent: "review the diff" }),
          step({ stepId: "fix", intent: "fix findings" }),
        ],
      }),
    )
    expect(html).toContain('data-status="spawning"')
    expect(html).toContain("review the diff")
    expect(html).toContain("fix findings")
  })

  test("a skipped step renders distinctly from a failed one", async () => {
    const skippedHtml = await render(
      run({ steps: [step({ status: "skipped", reason: 'dependency "review" did not complete' })] }),
    )
    const failedHtml = await render(
      run({ steps: [step({ status: "failed", reason: "spawn failed: boom" })] }),
    )

    expect(skippedHtml).toContain('data-status="skipped"')
    expect(skippedHtml).toContain("Skipped")
    expect(failedHtml).toContain('data-status="failed"')
    expect(failedHtml).toContain("Failed")

    // Pull each step badge's own class list (by its label text, since the
    // run-level chip above it also carries `badge-sm`) and assert they
    // differ — "we never tried this" (skipped) must not read the same colour
    // as "this broke" (failed).
    const stepBadgeClass = (html: string, label: string): string => {
      const idx = html.indexOf(`>${label}<`)
      const start = html.lastIndexOf('class="', idx)
      const end = html.indexOf('"', start + 'class="'.length)
      return html.slice(start, end)
    }
    const skippedBadge = stepBadgeClass(skippedHtml, "Skipped")
    const failedBadge = stepBadgeClass(failedHtml, "Failed")
    expect(skippedBadge).not.toBe(failedBadge)
    expect(skippedBadge).not.toContain("text-error")
    expect(failedBadge).toContain("text-error")
  })

  test("shows the reason for a skip or failure", async () => {
    const html = await render(
      run({ steps: [step({ status: "failed", reason: "spawn failed: quota" })] }),
    )
    expect(html).toContain('data-testid="fleet-run-step-reason"')
    expect(html).toContain("spawn failed: quota")
  })

  test("links each spawned short to its session drill-in", async () => {
    const html = await render(
      run({ steps: [step({ shorts: [{ short: "abc123", wait: undefined }] })] }),
    )
    expect(html).toContain('data-testid="fleet-run-short-link"')
    expect(html).toContain("/sessions/abc123")
    expect(html).toContain(">abc123<")
  })

  test("shows a wait outcome once a short's pinned wait resolves", async () => {
    const html = await render(
      run({
        steps: [
          step({
            shorts: [
              { short: "abc123", wait: { _tag: "Satisfied", state: "done", waitedMs: 4200 } },
            ],
          }),
        ],
      }),
    )
    expect(html).toContain("reached done")
  })
})
