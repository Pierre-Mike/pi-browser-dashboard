import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SpawnErrorNotice } from "./SpawnErrorNotice"

const render = (message: string | null): string =>
  renderToStaticMarkup(createElement(SpawnErrorNotice, { message }))

describe("SpawnErrorNotice", () => {
  test("shows the dispatch failure so a dead spawn is never silent", () => {
    const html = render("No API key for provider: anthropic")
    expect(html).toContain('data-testid="spawn-error"')
    expect(html).toContain("No API key for provider: anthropic")
  })

  test("renders nothing when there is no error", () => {
    expect(render(null)).toBe("")
    expect(render("")).toBe("")
  })
})
