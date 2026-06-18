import { describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SpawnModal } from "./SpawnModal"

const renderClosed = (): string => {
  const qc = new QueryClient()
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(SpawnModal, { open: false, project: null, onClose: () => {} }),
    ),
  )
}

describe("SpawnModal", () => {
  // The modal renders nothing while closed (and there is no document in SSR), so
  // its portal never mounts. This still exercises the data hooks for regressions.
  test("renders nothing while closed", () => {
    expect(renderClosed()).toBe("")
  })
})
