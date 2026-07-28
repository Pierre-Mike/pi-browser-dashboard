import { describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { FleetPanel } from "./FleetPanel"
import { renderWithRouter } from "./renderWithRouter"

// FleetPanel wires useFleets/useFleetRuns/useRunFleet (react-query) into
// FleetView, which renders a <Link> for each run — needs both a QueryClient
// and a router context, see renderWithRouter.ts.
const render = (): Promise<string> => {
  const qc = new QueryClient()
  return renderWithRouter(() =>
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(FleetPanel, { projectId: "demo", projectName: "demo-project" }),
    ),
  )
}

describe("FleetPanel", () => {
  // Exercises the live query wiring end to end; SSR never resolves the fetch,
  // so this only proves the panel mounts and renders its loading shell.
  test("mounts and renders the panel shell in its loading state", async () => {
    const html = await render()
    expect(html).toContain('data-testid="fleet-panel"')
    expect(html).toContain("Loading fleets")
  })
})
